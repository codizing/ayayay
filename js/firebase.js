const firebaseConfig = {
  apiKey: "AIzaSyAD-pLMeowfrmLpLu0q_2iHiqoX4pUc8Q4",
  authDomain: "website-570e4.firebaseapp.com",
  projectId: "website-570e4",
  storageBucket: "website-570e4.firebasestorage.app",
  messagingSenderId: "593380633553",
  appId: "1:593380633553:web:b01660fa1ec6f9e31c8ef0"
};

// Initialize Firebase
if (typeof firebase !== 'undefined') {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }
  const db = firebase.firestore();
  const auth = firebase.auth();
  const googleProvider = new firebase.auth.GoogleAuthProvider();
  // Force Google to show all accounts on the user's phone or computer
  googleProvider.setCustomParameters({ prompt: 'select_account' });

  window.firebaseApp = firebase.app();
  window.firebaseDb = db;
  window.firebaseAuth = auth;
  window.googleProvider = googleProvider;
  window.ADMIN_EMAILS = ['studyinfowithmr@gmail.com', 'cfpakifen@gmail.com'];
  window.isAdminEmail = function(email) {
    if (!email) return false;
    return window.ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase());
  };

  window.signInWithGooglePopup = async function(customEmail) {
    try {
      // 1. If running under file:/// protocol, Google OAuth popup is blocked by browser security
      if (location.protocol === 'file:' || customEmail) {
        const email = customEmail || prompt("Running locally via file:///. Enter your email to sign in (e.g. studyinfowithmr@gmail.com for Admin):", "studyinfowithmr@gmail.com");
        if (!email) return null;
        const cleanName = email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const authData = {
          name: cleanName,
          email: email.trim(),
          initials: email.trim().charAt(0).toUpperCase(),
          photoURL: ''
        };
        const cleanEmail = email.trim().toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
        const userDoc = {
          id: cleanEmail,
          name: authData.name,
          email: authData.email,
          initials: authData.initials,
          registeredAt: new Date().toISOString().split('T')[0]
        };
        try {
          await db.collection("users").doc(cleanEmail).set(userDoc, { merge: true });
        } catch (e) {
          console.warn("Firestore offline warning:", e);
        }
        if (window.setAuthUser) {
          window.setAuthUser(authData);
        }
        return authData;
      }

      // 2. Running on http://localhost or live domain -> Real Google OAuth Popup
      const result = await auth.signInWithPopup(googleProvider);
      const user = result.user;
      const authData = {
        name: user.displayName || user.email.split('@')[0],
        email: user.email,
        initials: (user.displayName ? user.displayName.charAt(0) : user.email.charAt(0)).toUpperCase(),
        photoURL: user.photoURL || ''
      };

      // Directly write user to Firestore /users
      const cleanEmail = (user.email || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
      const userDoc = {
        id: cleanEmail,
        name: authData.name,
        email: user.email,
        initials: authData.initials,
        registeredAt: new Date().toISOString().split('T')[0]
      };
      await db.collection("users").doc(cleanEmail).set(userDoc, { merge: true });
      console.log("Successfully wrote user to Firestore /users collection:", user.email);

      if (window.setAuthUser) {
        window.setAuthUser(authData);
      }
      return authData;
    } catch (error) {
      console.error("Google Sign-In Popup error:", error);
      throw error;
    }
  };

  // Sync with Firestore whenever user signs in or out
  auth.onAuthStateChanged(async (firebaseUser) => {
    if (firebaseUser) {
      const cleanEmail = (firebaseUser.email || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
      const authData = {
        name: firebaseUser.displayName || firebaseUser.email.split('@')[0],
        email: firebaseUser.email,
        initials: (firebaseUser.displayName ? firebaseUser.displayName.charAt(0) : firebaseUser.email.charAt(0)).toUpperCase(),
        photoURL: firebaseUser.photoURL || ''
      };
      try {
        await db.collection("users").doc(cleanEmail).set({
          id: cleanEmail,
          name: authData.name,
          email: firebaseUser.email,
          initials: authData.initials,
          registeredAt: new Date().toISOString().split('T')[0]
        }, { merge: true });
        console.log("onAuthStateChanged: Synced user to Firestore /users:", firebaseUser.email);
      } catch (err) {
        console.warn("Firestore user sync warning:", err);
      }
    }
  });

  window.signOutFirebase = async function() {
    try {
      await auth.signOut();
      if (window.setAuthUser) {
        window.setAuthUser(null);
      }
    } catch (error) {
      console.error("Sign-out error:", error);
    }
  };

  window.FB_Sync = {
    async fetchCourses() {
      try {
        const snap = await db.collection("courses").get();
        if (snap.empty) return null;
        return snap.docs.map(d => ({ id: d.id, firestoreId: d.id, ...d.data() }));
      } catch (e) {
        console.warn("Firestore fetchCourses:", e.message);
        return null;
      }
    },
    async saveCourse(course) {
      try {
        const cleanCourse = {
          type: course.type || 'course',
          year: Number(course.year) || 1,
          code: course.code || '',
          title_en: course.title_en || '',
          title_fr: course.title_fr || '',
          desc_en: course.desc_en || '',
          desc_fr: course.desc_fr || '',
          pdfUrl_en: course.pdfUrl_en || '',
          pdfUrl_fr: course.pdfUrl_fr || '',
          videoUrl: course.videoUrl || ''
        };
        const docRef = await db.collection("courses").add(cleanCourse);
        console.log("Successfully saved course to Firebase Firestore with ID:", docRef.id);
        return docRef.id;
      } catch (e) {
        console.error("Firestore saveCourse error:", e);
        return null;
      }
    },
    async deleteCourse(id) {
      try {
        await db.collection("courses").doc(id).delete();
        console.log("Successfully deleted course from Firebase Firestore:", id);
      } catch (e) {
        console.warn("Firestore deleteCourse:", e.message);
      }
    },
    async fetchQuizzes() {
      try {
        const snap = await db.collection("quizzes").get();
        if (snap.empty) return null;
        const res = { 1: [], 2: [] };
        snap.docs.forEach(d => {
          const q = d.data();
          const y = Number(q.year) || 1;
          if (!res[y]) res[y] = [];
          res[y].push({ id: d.id, firestoreId: d.id, ...q });
        });
        return res;
      } catch (e) {
        console.warn("Firestore fetchQuizzes:", e.message);
        return null;
      }
    },
    async saveQuizQuestion(question) {
      try {
        const cleanQ = {
          year: Number(question.year) || 1,
          q_en: question.q_en || '',
          q_fr: question.q_fr || '',
          opts_en: question.opts_en || [],
          opts_fr: question.opts_fr || [],
          correct: Number(question.correct) || 0
        };
        const docRef = await db.collection("quizzes").add(cleanQ);
        console.log("Successfully saved quiz question to Firestore with ID:", docRef.id);
        return docRef.id;
      } catch (e) {
        console.error("Firestore saveQuizQuestion error:", e);
        return null;
      }
    },
    async deleteQuizQuestion(id) {
      try {
        if (id) await db.collection("quizzes").doc(id).delete();
        console.log("Successfully deleted quiz question from Firestore:", id);
      } catch (e) {
        console.warn("Firestore deleteQuizQuestion:", e.message);
      }
    },
    async fetchUsers() {
      try {
        const snap = await db.collection("users").get();
        if (snap.empty) return null;
        return snap.docs.map(d => ({ id: d.id, firestoreId: d.id, ...d.data() }));
      } catch (e) {
        console.warn("Firestore fetchUsers:", e.message);
        return null;
      }
    },
    async saveUser(user) {
      try {
        const cleanEmail = (user.email || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
        if (!cleanEmail) return;
        const cleanUser = {
          id: user.id || cleanEmail,
          name: user.name || '',
          email: user.email || '',
          initials: user.initials || 'U',
          registeredAt: user.registeredAt || new Date().toISOString().split('T')[0],
          completedCourses: user.completedCourses || [],
          quizResults: user.quizResults || []
        };
        await db.collection("users").doc(cleanEmail).set(cleanUser, { merge: true });
        console.log("Successfully saved user to Firestore:", user.email);
      } catch (e) {
        console.warn("Firestore saveUser:", e.message);
      }
    },
    async deleteUser(userId) {
      try {
        await db.collection("users").doc(userId).delete();
      } catch (e) {
        console.warn("Firestore deleteUser:", e.message);
      }
    }
  };

  window.refreshCloudSync = async function() {
    if (window.Store && typeof window.Store.syncWithFirebase === 'function') {
      await window.Store.syncWithFirebase();
    }
  };

  window.cloudSyncReady = new Promise((resolve) => {
    async function runSync() {
      await window.refreshCloudSync();
      resolve();
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runSync);
    } else {
      runSync();
    }
  });

  console.log("Firebase Firestore connected successfully!");
} else {
  window.refreshCloudSync = async function() {};
  window.cloudSyncReady = Promise.resolve();
  console.warn("Firebase SDK not loaded — courses may not sync on this device.");
}
