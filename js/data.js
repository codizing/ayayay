/* ==========================================================================
   DATA LAYER
   Courses, quizzes and admin-added content live in localStorage so the
   "admin" (whoever has access to /admin.html) can add PDFs/videos without
   touching code. Students only ever read this data.
   Swap this file for real API calls if/when a backend is added — every
   other page only talks to the functions below, never to localStorage
   directly.
   ========================================================================== */

const DB_KEY = 'csp_db_v4';
let memoryDB = null;

function normalizeCourse(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    ...c,
    id: c.id || c.firestoreId || ('c' + Date.now()),
    firestoreId: c.firestoreId || c.id || '',
    type: c.type || 'course',
    year: Number(c.year) || 1,
    code: c.code || 'CS',
    title_en: c.title_en || c.title_fr || '',
    title_fr: c.title_fr || c.title_en || '',
    desc_en: c.desc_en || c.desc_fr || '',
    desc_fr: c.desc_fr || c.desc_en || '',
    pdfUrl_en: c.pdfUrl_en || c.pdfUrl || '',
    pdfUrl_fr: c.pdfUrl_fr || c.pdfUrl || '',
    videoUrl: c.videoUrl || ''
  };
}

function normalizeCourses(list) {
  return (list || []).map(normalizeCourse).filter(Boolean);
}

function normalizeDB(db) {
  db.courses = normalizeCourses(db.courses);
  db.courses.forEach(c => {
    if (!c.pdfUrl_en && c.pdfUrl) c.pdfUrl_en = c.pdfUrl;
    if (!c.pdfUrl_fr && c.pdfUrl) c.pdfUrl_fr = c.pdfUrl;
  });
  if (!db.quizzes || typeof db.quizzes !== 'object') db.quizzes = { 1: [], 2: [] };
  if (!db.users || !Array.isArray(db.users)) db.users = [];
  return db;
}

const SEED = {
  courses: [],
  quizzes: {
    1: [],
    2: []
  },
  users: []
};

function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) {
      if (memoryDB) return structuredClone(memoryDB);
      const seed = structuredClone(SEED);
      memoryDB = seed;
      try { localStorage.setItem(DB_KEY, JSON.stringify(SEED)); } catch (e) { /* phone storage blocked */ }
      return structuredClone(seed);
    }
    try {
      const db = JSON.parse(raw);
      if (!db.courses || !Array.isArray(db.courses)) {
        const seed = structuredClone(SEED);
        saveDB(seed);
        return seed;
      }
      return normalizeDB(db);
    }
    catch (e) {
      if (memoryDB) return structuredClone(memoryDB);
      const seed = structuredClone(SEED);
      saveDB(seed);
      return seed;
    }
  } catch (e) {
    if (memoryDB) return structuredClone(memoryDB);
    memoryDB = structuredClone(SEED);
    return structuredClone(SEED);
  }
}
function saveDB(db) {
  memoryDB = structuredClone(normalizeDB(db));
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(memoryDB));
  } catch (e) {
    console.warn('localStorage unavailable (common on mobile private mode) — using memory cache');
  }
}

function notifyStoreUpdated() {
  document.dispatchEvent(new CustomEvent('dbupdated'));
  if (typeof window.updateHomeYearCounts === 'function') {
    window.updateHomeYearCounts();
  }
}

const Store = {
  async pushUnsyncedToCloud(db) {
    if (!window.FB_Sync) return false;
    let pushed = false;

    for (const course of db.courses) {
      if (course.firestoreId) continue;
      const id = await window.FB_Sync.saveCourse(course);
      if (id) {
        course.firestoreId = id;
        pushed = true;
      }
    }

    for (const year of [1, 2]) {
      for (const question of (db.quizzes[year] || [])) {
        if (question.firestoreId) continue;
        const id = await window.FB_Sync.saveQuizQuestion(question);
        if (id) {
          question.firestoreId = id;
          pushed = true;
        }
      }
    }

    for (const user of (db.users || [])) {
      if (user.firestoreId) continue;
      await window.FB_Sync.saveUser(user);
      user.firestoreId = (user.email || '').toLowerCase().replace(/[^a-zA-Z0-9]/g, '_');
      pushed = true;
    }

    if (pushed) saveDB(db);
    return pushed;
  },
  async uploadLocalIfNeeded() {
    const db = loadDB();
    const hasUnsynced = db.courses.some(c => !c.firestoreId)
      || [1, 2].some(y => (db.quizzes[y] || []).some(q => !q.firestoreId));
    if (!hasUnsynced) return 0;

    const pushed = await this.pushUnsyncedToCloud(db);
    if (pushed) {
      document.dispatchEvent(new CustomEvent('dbupdated'));
    }
    return pushed ? db.courses.length : 0;
  },
  async syncWithFirebase() {
    if (!window.FB_Sync) return;
    const attempts = 3;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const db = loadDB();

        const cloudCourses = await window.FB_Sync.fetchCourses();
        const cloudQuizzes = await window.FB_Sync.fetchQuizzes();
        const cloudUsers = await window.FB_Sync.fetchUsers();

        let updated = false;

        // Firebase is the source of truth when fetch succeeds (even if empty [])
        if (cloudCourses !== null) {
          db.courses = normalizeCourses(cloudCourses);
          updated = true;
        }

        if (cloudQuizzes !== null) {
          db.quizzes = {
            1: cloudQuizzes[1] || [],
            2: cloudQuizzes[2] || []
          };
          updated = true;
        }

        if (cloudUsers !== null && cloudUsers.length) {
          db.users = cloudUsers;
          updated = true;
        }

        // Offline only: upload items that were never saved to Firebase
        if (cloudCourses === null) {
          const hasUnsynced = db.courses.some(c => !c.firestoreId)
            || [1, 2].some(y => (db.quizzes[y] || []).some(q => !q.firestoreId));
          if (hasUnsynced) {
            const pushed = await this.pushUnsyncedToCloud(db);
            if (pushed) updated = true;
          }
        } else if (cloudCourses.length === 0) {
          const hasUnsynced = db.courses.some(c => !c.firestoreId);
          if (hasUnsynced) {
            const pushed = await this.pushUnsyncedToCloud(db);
            if (pushed) updated = true;
          }
        }

        if (updated) saveDB(db);
        notifyStoreUpdated();
        // cloudCourses === null means every attempt to actually reach
        // Firestore failed and we're just showing whatever was cached.
        return cloudCourses !== null;
      } catch (e) {
        console.warn("syncWithFirebase error:", e);
      }
      await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
    }
    return false;
  },
  applyCloudCourses(courses) {
    const db = loadDB();
    db.courses = normalizeCourses(courses);
    saveDB(db);
    notifyStoreUpdated();
  },
  applyCloudQuizzes(quizzes) {
    const db = loadDB();
    db.quizzes = {
      1: quizzes[1] || [],
      2: quizzes[2] || []
    };
    saveDB(db);
    notifyStoreUpdated();
  },
  async fetchCoursesFromCloud() {
    if (!window.FB_Sync) return [];
    const cloud = await window.FB_Sync.fetchCourses();
    if (cloud === null) return [];
    this.applyCloudCourses(cloud);
    return normalizeCourses(cloud);
  },
  getYearStats(year) {
    return {
      courses: this.getCourses(year, 'course').length,
      td: this.getCourses(year, 'td').length,
      exam: this.getCourses(year, 'exam').length,
      quiz: this.getQuiz(year).length
    };
  },
  getCourses(year, type) {
    const db = loadDB();
    return db.courses.filter(c => {
      const cYear = Number(c.year) || 1;
      const cType = c.type || 'course';
      if (year && cYear !== Number(year)) return false;
      if (type && cType !== type) return false;
      return true;
    });
  },
  getAllCourses() {
    const db = loadDB();
    return db.courses || [];
  },
  addCourse(course) {
    const db = loadDB();
    course.id = (course.type || 'c') + Date.now();
    if (!course.type) course.type = 'course';
    if (!course.pdfUrl_en) course.pdfUrl_en = course.pdfUrl || '';
    if (!course.pdfUrl_fr) course.pdfUrl_fr = course.pdfUrl || '';
    db.courses.push(course);
    saveDB(db);
    document.dispatchEvent(new CustomEvent('dbupdated'));

    if (window.FB_Sync) {
      window.FB_Sync.saveCourse(course).then(id => {
        if (id) {
          course.firestoreId = id;
          saveDB(db);
        }
      });
    }
    return course;
  },
  updateCourse(id, patch) {
    const db = loadDB();
    const i = db.courses.findIndex(c => c.id === id);
    if (i > -1) {
      db.courses[i] = { ...db.courses[i], ...patch };
      saveDB(db);
      document.dispatchEvent(new CustomEvent('dbupdated'));
    }
  },
  deleteCourse(id) {
    const db = loadDB();
    const target = db.courses.find(c => c.id === id);
    db.courses = db.courses.filter(c => c.id !== id);
    // Also cleanup completed course references in users
    if (db.users) {
      db.users.forEach(u => {
        if (u.completedCourses) {
          u.completedCourses = u.completedCourses.filter(cid => cid !== id);
        }
      });
    }
    saveDB(db);
    notifyStoreUpdated();

    if (window.FB_Sync && target) {
      const cloudId = target.firestoreId || target.id;
      window.FB_Sync.deleteCourse(cloudId);
    }
  },
  getQuiz(year) {
    const db = loadDB();
    return (db.quizzes[year] || []);
  },
  addQuestion(year, question) {
    const db = loadDB();
    if (!db.quizzes[year]) db.quizzes[year] = [];
    question.id = 'q_' + Date.now();
    question.year = Number(year);
    db.quizzes[year].push(question);
    saveDB(db);
    document.dispatchEvent(new CustomEvent('dbupdated'));

    if (window.FB_Sync) {
      window.FB_Sync.saveQuizQuestion(question).then(id => {
        if (id) {
          question.firestoreId = id;
          saveDB(db);
        }
      });
    }
  },
  deleteQuestion(year, index) {
    const db = loadDB();
    const removed = db.quizzes[year]?.splice(index, 1);
    saveDB(db);
    document.dispatchEvent(new CustomEvent('dbupdated'));

    if (window.FB_Sync && removed && removed[0]) {
      window.FB_Sync.deleteQuizQuestion(removed[0].firestoreId || removed[0].id);
    }
  },
  // ----- USERS & PROGRESS METHODS -----
  getUsers() {
    const db = loadDB();
    return db.users || [];
  },
  getUserByEmail(email) {
    if (!email) return null;
    const db = loadDB();
    return (db.users || []).find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
  },
  ensureUser(user) {
    if (!user || !user.email) return null;
    const db = loadDB();
    if (!db.users) db.users = [];
    let existing = db.users.find(u => u.email.toLowerCase() === user.email.toLowerCase());
    if (!existing) {
      existing = {
        id: 'u_' + Date.now(),
        name: user.name || user.email.split('@')[0],
        email: user.email,
        initials: (user.name ? user.name.charAt(0) : user.email.charAt(0)).toUpperCase(),
        registeredAt: new Date().toISOString().split('T')[0],
        completedCourses: [],
        quizResults: []
      };
      db.users.push(existing);
      saveDB(db);

      if (window.FB_Sync) {
        window.FB_Sync.saveUser(existing);
      }
    }
    return existing;
  },
  addUser(userData) {
    const db = loadDB();
    if (!db.users) db.users = [];
    const email = userData.email.trim();
    if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) {
      return { error: 'User already exists' };
    }
    const name = userData.name.trim();
    const newUser = {
      id: 'u_' + Date.now(),
      name: name,
      email: email,
      initials: (name ? name.charAt(0) : email.charAt(0)).toUpperCase(),
      registeredAt: new Date().toISOString().split('T')[0],
      completedCourses: [],
      quizResults: []
    };
    db.users.push(newUser);
    saveDB(db);

    if (window.FB_Sync) {
      window.FB_Sync.saveUser(newUser);
    }
    return newUser;
  },
  deleteUser(userId) {
    const db = loadDB();
    if (db.users) {
      db.users = db.users.filter(u => u.id !== userId);
      saveDB(db);
    }
    if (window.FB_Sync) {
      window.FB_Sync.deleteUser(userId);
    }
  },
  resetUserProgress(userId) {
    const db = loadDB();
    if (db.users) {
      const user = db.users.find(u => u.id === userId);
      if (user) {
        user.completedCourses = [];
        user.quizResults = [];
        saveDB(db);
        if (window.FB_Sync) {
          window.FB_Sync.saveUser(user);
        }
      }
    }
  },
  toggleCourseCompletion(email, courseId) {
    if (!email || !courseId) return false;
    const db = loadDB();
    let user = (db.users || []).find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      user = this.ensureUser({ email, name: email.split('@')[0] });
    }
    if (!user.completedCourses) user.completedCourses = [];
    const idx = user.completedCourses.indexOf(courseId);
    let isCompleted = false;
    if (idx > -1) {
      user.completedCourses.splice(idx, 1);
      isCompleted = false;
    } else {
      user.completedCourses.push(courseId);
      isCompleted = true;
    }
    saveDB(db);

    if (window.FB_Sync) {
      window.FB_Sync.saveUser(user);
    }
    return isCompleted;
  },
  isCourseCompleted(email, courseId) {
    if (!email || !courseId) return false;
    const user = this.getUserByEmail(email);
    return !!(user && user.completedCourses && user.completedCourses.includes(courseId));
  },
  saveQuizResult(email, result) {
    if (!email) return;
    const db = loadDB();
    let user = (db.users || []).find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      user = this.ensureUser({ email, name: email.split('@')[0] });
    }
    if (!user.quizResults) user.quizResults = [];
    const entry = {
      year: Number(result.year),
      score: Number(result.score),
      total: Number(result.total),
      percent: Math.round((result.score / result.total) * 100),
      date: new Date().toISOString().split('T')[0]
    };
    user.quizResults.push(entry);
    saveDB(db);

    if (window.FB_Sync) {
      window.FB_Sync.saveUser(user);
    }
    return entry;
  },
  resetAll() {
    localStorage.setItem(DB_KEY, JSON.stringify(SEED));
  }
};
