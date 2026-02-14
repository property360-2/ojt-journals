
import { db, serverTimestamp } from './firebase-core.js';
import {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    query,
    where,
    orderBy,
    updateDoc
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

/**
 * Calculate OJT Week Number relative to student's start date
 */
export function calculateWeekNumber(dateStr, ojtStartDate) {
    if (!ojtStartDate) return 1;

    const start = new Date(ojtStartDate);
    const current = new Date(dateStr);

    // Calculate difference in days
    const diffTime = current - start;
    if (diffTime < 0) return 1; // Before start date

    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
}

/**
 * Check if a date is a workday for a specific student
 */
export async function checkWorkday(dateStr, userId) {
    try {
        // 1. Check Global Overrides (Holidays/Admin defined)
        const workdayRef = doc(db, "workdays", dateStr);
        const workdaySnap = await getDoc(workdayRef);
        if (workdaySnap.exists()) {
            return workdaySnap.data().isWorkday;
        }

        // 2. Check Student individual schedule
        const userDoc = await getDoc(doc(db, "users", userId));
        if (!userDoc.exists()) return true;

        const userData = userDoc.data();
        const schedule = userData.workSchedule || [1, 2, 3, 4, 5]; // Default Mon-Fri
        const dayOfWeek = new Date(dateStr).getDay();

        return schedule.includes(dayOfWeek);
    } catch (error) {
        console.error("Check Workday Error:", error);
        return true;
    }
}

/**
 * Get student submission progress vs their specific schedule
 */
export async function getStudentProgress(userId) {
    try {
        const userDoc = await getDoc(doc(db, "users", userId));
        if (!userDoc.exists()) throw new Error("User not found");

        const userData = userDoc.data();
        const ojtStart = userData.ojtStart;
        const schedule = userData.workSchedule || [1, 2, 3, 4, 5];

        const journals = await getStudentJournals(userId);
        const submittedDates = new Set(journals.filter(j => j.submitted).map(j => j.date));

        let missingDates = [];
        if (ojtStart) {
            const startDate = new Date(ojtStart);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            // Loop from start date to today
            let current = new Date(startDate);
            while (current <= today) {
                const dateStr = current.toISOString().split('T')[0];
                const dayOfWeek = current.getDay();

                // If it's a scheduled workday AND no journal exists
                if (schedule.includes(dayOfWeek) && !submittedDates.has(dateStr)) {
                    // Also check for global holiday overrides if you want to be super detailed
                    // But for now, just schedule check
                    missingDates.push(dateStr);
                }

                current.setDate(current.getDate() + 1);
            }
        }

        return {
            totalSubmitted: submittedDates.size,
            totalMissing: missingDates.length,
            missingDates: missingDates,
            journals: journals,
            userData: userData
        };
    } catch (error) {
        console.error("Get Student Progress Error:", error);
        throw error;
    }
}

/**
 * Create or Update a journal entry
 */
export async function saveJournal(userId, date, content, submitted = false) {
    const isWorkday = await checkWorkday(date, userId);
    if (!isWorkday && submitted) {
        throw new Error("This date is not part of your OJT schedule.");
    }

    const userDoc = await getDoc(doc(db, "users", userId));
    const userData = userDoc.data();
    const week = calculateWeekNumber(date, userData?.ojtStart);

    const journalId = `${userId}_${date}`;
    const journalData = {
        userId,
        date,
        week,
        content,
        submitted,
        reviewed: false,
        remarks: "",
        updatedAt: serverTimestamp()
    };

    if (submitted) {
        journalData.timestamp = serverTimestamp();
    }

    try {
        const journalRef = doc(db, "journals", journalId);
        const journalDoc = await getDoc(journalRef);

        if (journalDoc.exists() && journalDoc.data().reviewed) {
            throw new Error("Cannot edit a journal that has already been reviewed.");
        }

        await setDoc(journalRef, journalData, { merge: true });
        return { id: journalId, ...journalData };
    } catch (error) {
        console.error("Save Journal Error:", error);
        throw error;
    }
}

/**
 * Fetch all journals for a specific student
 */
export async function getStudentJournals(userId) {
    try {
        const q = query(
            collection(db, "journals"),
            where("userId", "==", userId),
            orderBy("date", "desc")
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
        console.error("Get Student Journals Error:", error);
        throw error;
    }
}

/**
 * Fetch a specific journal entry
 */
export async function getJournal(userId, date) {
    const journalId = `${userId}_${date}`;
    const docRef = doc(db, "journals", journalId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return { id: docSnap.id, ...docSnap.data() };
    } else {
        return null;
    }
}
