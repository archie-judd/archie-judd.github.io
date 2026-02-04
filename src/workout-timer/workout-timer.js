// --- CONSTANTS ---

const STATUS = {
  EDITING: "editing",
  IN_PROGRESS: "in_progress",
  PAUSED: "paused",
  DONE: "done",
};

const TRANSITION_DURATION_S = 5;

const STORAGE_KEY_WORKOUT = "workoutText";

// --- TYPE DEFINITIONS ---

/**
 * @typedef {Object} WorkoutStep
 * @property {string} type - Step type: "transition", "time", or "reps"
 * @property {string} [name] - Exercise name
 * @property {string} [value] - Rep count or duration string
 * @property {number} [duration] - Duration in seconds (for time-based exercises)
 * @property {string} [nextExercise] - Name of next exercise (for transitions)
 */

/**
 * @typedef {Object} State
 * @property {string} status - Current status (editing/in_progress/paused/done)
 * @property {WorkoutStep[]} workoutData - Parsed workout steps
 * @property {number} stepIndex - Current step index
 * @property {number} stepTimeLeft - Seconds remaining in current phase
 * @property {number} stepDuration - Total duration of current phase in seconds
 * @property {number} workoutElapsed - Total workout elapsed time in seconds
 * @property {number} stepStartTime - Timestamp when phase started
 * @property {NodeJS.Timeout|null} stepTimer - Phase timer interval ID
 * @property {NodeJS.Timeout|null} workoutTimer - Workout timer interval ID
 */

// --- DOM REFERENCES ---

const DOM = {
  editorView: document.getElementById("editor-view"),
  workoutView: document.getElementById("workout-view"),
  inputText: /** @type {HTMLTextAreaElement} */ (
    document.getElementById("input-text")
  ),
  currentExercise: document.getElementById("current-exercise"),
  timerDisplay: document.getElementById("timer-display"),
  repDisplay: document.getElementById("rep-display"),
  statusText: document.getElementById("status-text"),
  nextIndicator: document.getElementById("next-indicator"),
  progressIndicator: document.getElementById("progress-indicator"),
  playPauseBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("play-pause-btn")
  ),
  displayContainer: document.getElementById("display-container"),
  elapsedTime: document.getElementById("elapsed-time"),
  progressBarContainer: document.getElementById("progress-bar-container"),
  progressBar: document.getElementById("progress-bar"),
  startBtn: document.getElementById("start-btn"),
  stopBtn: document.getElementById("stop-btn"),
  prevBtn: document.getElementById("prev-btn"),
  nextBtn: document.getElementById("next-btn"),
};

// --- AUDIO MODULE ---

const unlockAutoplayLock = () => {
  if (!window.speechSynthesis) {
    throw new Error("Speech Synthesis API not supported in this browser.");
  }
  if (!window.speechSynthesis.speaking && !audioUnlocked) {
    const utterance = new SpeechSynthesisUtterance(" ");
    window.speechSynthesis.speak(utterance);
    audioUnlocked = true;
  }
};

const initVoice = () => {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    const voice =
      voices.find((v) => v.name === "Samantha") ||
      voices.find((v) => v.name === "Google US English") ||
      voices.find((v) => v.lang === "en-US") ||
      voices.find((v) => v.lang.startsWith("en")) ||
      voices[0];
    return voice;
  }
};

/** @param {string} text */
const speakNonBlocking = (text) => {
  if (voice === undefined || voice === null) {
    throw new Error("No speech synthesis voice available");
  }
  if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) {
    utterance.voice = voice;
  }
  window.speechSynthesis.speak(utterance);
  return utterance;
};

/** @param {string} text */
const speakBlocking = async (text) => {
  return new Promise((resolve, reject) => {
    const utterance = speakNonBlocking(text);
    utterance.onend = () => resolve();
    utterance.onerror = (event) =>
      reject(new Error(`Speech error: ${event.error}`));
  });
};

const cancelSpeech = () => {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
  }
};

// --- WORKOUT PARSER ---

/** @param {string} text */
const parseWorkout = (text) => {
  const lines = text.split("\n");
  const exercises = [];

  lines.forEach((line) => {
    line = line.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) return;

    const parts = line.split("|");
    const name = parts[0].trim();
    const valRaw = parts[1] ? parts[1].trim() : "";

    let type = "reps";
    let duration = 0;

    if (valRaw.match(/(\d+)\s*(s|sec)/i)) {
      type = "time";
      duration = parseInt(valRaw.match(/\d+/)[0]);
    }

    exercises.push({ name, type, value: valRaw, duration });
  });

  // Interleave transitions between exercises
  const result = [];
  exercises.forEach((exercise, _) => {
    result.push({
      type: "transition",
      duration: TRANSITION_DURATION_S,
      nextExercise: exercise.name,
    });
    result.push(exercise);
  });

  return result;
};

// --- STATE INITIALIZATION ---

/**
 * @param {WorkoutStep[]} workoutData
 * @returns {State}
 */
const initState = (workoutData) => ({
  status: STATUS.EDITING,
  workoutData: workoutData,
  stepIndex: 0,
  stepTimeLeft: 0,
  stepDuration: 0,
  workoutElapsed: 0,
  stepStartTime: 0,
  stepTimer: null,
  workoutTimer: null,
});

// --- TIMER MANAGEMENT ---

/**
 * @param {State} state
 */
const startWorkoutTimer = (state) => {
  const workoutStartTime = Date.now();
  state.workoutElapsed = 0;

  state.workoutTimer = setInterval(() => {
    state.workoutElapsed = Math.floor((Date.now() - workoutStartTime) / 1000);
    const mins = Math.floor(state.workoutElapsed / 60);
    const secs = state.workoutElapsed % 60;
    DOM.elapsedTime.innerText = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }, 1000);
};

/**
 * @param {State} state
 */
const stopWorkoutTimer = (state) => {
  if (state.workoutTimer) {
    clearInterval(state.workoutTimer);
    state.workoutTimer = null;
  }
};

/**
 * @param {State} state
 */
const startStepTimer = (state) => {
  stopStepTimer(state);
  state.stepTimer = setInterval(() => handleStepTimerTick(state), 1000);
};

/**
 * @param {State} state
 */
const stopStepTimer = (state) => {
  if (state.stepTimer) {
    clearInterval(state.stepTimer);
    state.stepTimer = null;
  }
};

/**
 * @param {State} state
 */
const handleStepTimerTick = (state) => {
  if (state.status === STATUS.PAUSED) return;

  state.stepTimeLeft--;
  updateDisplay(state);
  handleTimerEvents(state);

  if (state.stepTimeLeft <= 0) {
    handleTimerComplete(state);
  }
};

/**
 * @param {State} state
 */
const handleTimerEvents = (state) => {
  const step = state.workoutData[state.stepIndex];

  if (step.type === "transition") {
    if (state.stepTimeLeft > 0) {
      speakNonBlocking(state.stepTimeLeft.toString());
    }
  } else if (step.type === "time") {
    // Halfway announcement for exercises 20s or longer
    const halfwayPoint = Math.floor(step.duration / 2);
    if (step.duration >= 20 && state.stepTimeLeft === halfwayPoint) {
      speakNonBlocking("Halfway");
    }

    // Final countdown beeps
    if (state.stepTimeLeft <= 5 && state.stepTimeLeft > 0) {
      speakNonBlocking(state.stepTimeLeft.toString());
    }
  }
};

/**
 * @param {State} state
 */
const handleTimerComplete = (state) => {
  stopStepTimer(state);
  advanceToNextStep(state);
};

// --- DISPLAY UPDATES ---

/**
 * @param {State} state
 */
const updateProgressBar = (state) => {
  if (state.stepDuration > 0) {
    const progress =
      ((state.stepDuration - state.stepTimeLeft) / state.stepDuration) * 100;
    DOM.progressBar.style.width = `${Math.min(progress, 100)}%`;
  } else {
    DOM.progressBar.style.width = "0%";
  }
};

/**
 * @param {State} state
 */
const displayEditing = (state) => {
  DOM.editorView.style.display = "flex";
  DOM.workoutView.style.display = "none";
};

/**
 * @param {State} state
 */
const displayDone = (state) => {
  DOM.displayContainer.className = "main-display state-done";
  DOM.statusText.innerText = "";
  DOM.currentExercise.innerText = "";
  DOM.nextIndicator.innerText = "";
  DOM.repDisplay.style.display = "none";
  DOM.timerDisplay.style.display = "block";
  DOM.timerDisplay.innerText = "DONE";
  DOM.progressBarContainer.style.display = "none";
  DOM.playPauseBtn.disabled = true;
  DOM.editorView.style.display = "none";
  DOM.workoutView.style.display = "flex";
};

/**
 * @param {State} state
 */
const displayInProgress = (state) => {
  const step = state.workoutData[state.stepIndex];

  if (!step) {
    throw new Error(`Invalid step index: ${state.stepIndex}`);
  }

  // Show workout view
  DOM.editorView.style.display = "none";
  DOM.workoutView.style.display = "flex";

  // Update state class based on step type
  let stateClass = "";
  if (step.type === "transition") {
    stateClass = "state-transition";
  } else {
    stateClass = "state-work";
  }
  DOM.displayContainer.className = `main-display ${stateClass}`;

  // Update progress indicator
  DOM.progressIndicator.innerText = `${state.stepIndex + 1} / ${state.workoutData.length}`;

  // Update next indicator - skip over transitions to show next exercise
  let nextStepIndex = state.stepIndex + 1;
  while (
    nextStepIndex < state.workoutData.length &&
    state.workoutData[nextStepIndex].type === "transition"
  ) {
    nextStepIndex++;
  }
  const nextExercise = state.workoutData[nextStepIndex];

  // Update exercise name, status text, and next indicator based on step type
  if (step.type === "transition") {
    DOM.currentExercise.innerText = step.nextExercise;
    DOM.statusText.innerText = "GET READY";
    DOM.nextIndicator.innerText = "";
  } else {
    DOM.currentExercise.innerText = step.name;
    DOM.statusText.innerText = "";
    DOM.nextIndicator.innerText = nextExercise
      ? `NEXT: ${nextExercise.name}`
      : "NEXT: Finish";
  }

  // Update timer/reps display based on step type
  if (step.type === "reps") {
    DOM.timerDisplay.style.display = "none";
    DOM.repDisplay.style.display = "block";
    DOM.repDisplay.innerText = step.value || "REPS";
    DOM.progressBarContainer.style.display = "none";
    DOM.playPauseBtn.innerText = "DONE";
  } else {
    DOM.timerDisplay.style.display = "block";
    DOM.repDisplay.style.display = "none";
    DOM.timerDisplay.innerText = state.stepTimeLeft.toString();
    DOM.progressBarContainer.style.display = "block";
    DOM.playPauseBtn.innerText = "PAUSE";
  }

  DOM.playPauseBtn.disabled = false;
  updateProgressBar(state);
};

/**
 * @param {State} state
 */
const displayPaused = (state) => {
  const step = state.workoutData[state.stepIndex];

  if (!step) {
    throw new Error(`Invalid step index: ${state.stepIndex}`);
  }

  // Show workout view
  DOM.editorView.style.display = "none";
  DOM.workoutView.style.display = "flex";

  // Always use paused state class
  DOM.displayContainer.className = "main-display state-paused";

  // Update progress indicator
  DOM.progressIndicator.innerText = `${state.stepIndex + 1} / ${state.workoutData.length}`;

  // Update next indicator - skip over transitions to show next exercise
  let nextStepIndex = state.stepIndex + 1;
  while (
    nextStepIndex < state.workoutData.length &&
    state.workoutData[nextStepIndex].type === "transition"
  ) {
    nextStepIndex++;
  }
  const nextExercise = state.workoutData[nextStepIndex];

  // Update exercise name, status text, and next indicator based on step type
  if (step.type === "transition") {
    DOM.currentExercise.innerText = step.nextExercise;
    DOM.statusText.innerText = "GET READY";
    DOM.nextIndicator.innerText = "";
  } else {
    DOM.currentExercise.innerText = step.name;
    DOM.statusText.innerText = "";
    DOM.nextIndicator.innerText = nextExercise
      ? `NEXT: ${nextExercise.name}`
      : "NEXT: Finish";
  }

  // Update timer/reps display based on step type
  if (step.type === "reps") {
    DOM.timerDisplay.style.display = "none";
    DOM.repDisplay.style.display = "block";
    DOM.repDisplay.innerText = step.value || "REPS";
    DOM.progressBarContainer.style.display = "none";
    DOM.playPauseBtn.innerText = "DONE";
  } else {
    DOM.timerDisplay.style.display = "block";
    DOM.repDisplay.style.display = "none";
    DOM.timerDisplay.innerText = state.stepTimeLeft.toString();
    DOM.progressBarContainer.style.display = "block";
    DOM.playPauseBtn.innerText = "RESUME";
  }

  DOM.playPauseBtn.disabled = false;
  updateProgressBar(state);
};

/**
 * @param {State} state
 */
const updateDisplay = (state) => {
  switch (state.status) {
    case STATUS.EDITING:
      displayEditing(state);
      break;
    case STATUS.DONE:
      displayDone(state);
      break;
    case STATUS.IN_PROGRESS:
      displayInProgress(state);
      break;
    case STATUS.PAUSED:
      displayPaused(state);
      break;
    default:
      throw new Error(`Unknown status: ${state.status}`);
  }
};

// --- WAKE LOCK ---

const acquireScreenWakeLock = async () => {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    }
  } catch (err) {
    console.warn("Wake Lock ignored");
  }
};

const releaseScreenWakeLock = async () => {
  if (wakeLock) wakeLock.release();
};

// --- WORKFLOW CONTROL ---

const startWorkout = async () => {
  // 1. Unlock audio on first user interaction
  unlockAutoplayLock();

  localStorage.setItem(STORAGE_KEY_WORKOUT, DOM.inputText.value);
  state.workoutData = parseWorkout(DOM.inputText.value);

  if (state.workoutData.length === 0) {
    throw new Error(
      "No valid workout steps found. Please enter at least one step.",
    );
  }
  await acquireScreenWakeLock();
  runWorkout(state);
};

/**
 * @param {State} state
 */
const runWorkout = async (state) => {
  state.stepIndex = 0;
  state.status = STATUS.IN_PROGRESS;
  updateDisplay(state);
  startWorkoutTimer(state);
  await startStep(state);
};

/**
 * @param {State} state
 */
const transitionToEditing = (state) => {
  stopStepTimer(state);
  stopWorkoutTimer(state);
  cancelSpeech();
  releaseScreenWakeLock();
  state.status = STATUS.EDITING;
  updateDisplay(state);
};

/**
 * @param {State} state
 */
const finishWorkout = (state) => {
  state.status = STATUS.DONE;
  stopStepTimer(state);
  speakNonBlocking("Workout Complete");
  updateDisplay(state);
};

// --- STEP MANAGEMENT ---

/**
 * @param {State} state
 * @returns {WorkoutStep}
 */
const getCurrentStep = (state) => {
  return state.workoutData[state.stepIndex];
};

/**
 * @param {State} state
 */
const startTransitionStep = async (state) => {
  const step = getCurrentStep(state);
  state.stepTimeLeft = step.duration;
  state.stepDuration = step.duration;
  updateDisplay(state);
  const msg = `Get ready for ${step.nextExercise}`;
  await speakBlocking(msg);
  startStepTimer(state);
};

/**
 * @param {State} state
 */
const startDurationBasedExercise = async (state) => {
  const step = getCurrentStep(state);
  state.stepTimeLeft = step.duration;
  state.stepDuration = step.duration;
  updateDisplay(state);
  const msg = `${step.name} for ${step.duration} seconds. Go!`;
  await speakBlocking(msg);
  startStepTimer(state);
};

/**
 * @param {State} state
 */
const startRepsBasedExercise = async (state) => {
  const step = getCurrentStep(state);
  // Reps-based exercise - no timer
  state.stepTimeLeft = 0;
  state.stepDuration = 0;
  updateDisplay(state);
  const msg = `${step.name}, ${step.value}. Press done when finished.`;
  await speakBlocking(msg);
};

/**
 * @param {State} state
 */
const startStep = async (state) => {
  const step = getCurrentStep(state);
  state.status = STATUS.IN_PROGRESS;
  state.stepStartTime = Date.now();

  if (step.type === "transition") await startTransitionStep(state);
  else if (step.type === "time") await startDurationBasedExercise(state);
  else if (step.type === "reps") await startRepsBasedExercise(state);
  else throw new Error(`Unknown step type: ${step.type}`);
};

/**
 * @param {State} state
 */
const advanceToNextStep = async (state) => {
  state.stepIndex++;

  if (state.stepIndex >= state.workoutData.length) {
    finishWorkout(state);
  } else {
    await startStep(state);
  }
};

// --- USER CONTROLS ---

/**
 * @param {State} state
 */
const togglePause = (state) => {
  const step = state.workoutData[state.stepIndex];

  // For reps-based exercises, "pause" button acts as "done"
  if (step.type === "reps") {
    advanceToNextStep(state);
    return;
  }

  // Toggle pause for timed exercises and transitions
  if (state.status === STATUS.PAUSED) {
    state.status = STATUS.IN_PROGRESS;
    startStepTimer(state); // Restart timer
  } else if (state.status === STATUS.IN_PROGRESS) {
    stopStepTimer(state); // Stop timer FIRST
    state.status = STATUS.PAUSED;
  }

  updateDisplay(state);
};

/**
 * @param {State} state
 */
const nextStep = (state) => {
  stopStepTimer(state);
  // Find the next transition step (skip to next exercise pair)
  let nextIndex = state.stepIndex + 1;
  while (
    nextIndex < state.workoutData.length &&
    state.workoutData[nextIndex].type !== "transition"
  ) {
    nextIndex++;
  }

  if (nextIndex >= state.workoutData.length) {
    finishWorkout(state);
  } else {
    state.stepIndex = nextIndex;
    startStep(state);
  }
};

/**
 * @param {State} state
 */
const prevStep = (state) => {
  stopStepTimer(state);
  const stepElapsed = Math.floor((Date.now() - state.stepStartTime) / 1000);

  // If we just started, go to previous transition; otherwise restart current transition
  if (stepElapsed < 1) {
    // Find the previous transition step
    let prevIndex = state.stepIndex - 1;
    while (
      prevIndex >= 0 &&
      state.workoutData[prevIndex].type !== "transition"
    ) {
      prevIndex--;
    }

    if (prevIndex >= 0) {
      state.stepIndex = prevIndex;
    }
  } else {
    // Restart from the current exercise's transition
    let transitionIndex = state.stepIndex;
    while (
      transitionIndex > 0 &&
      state.workoutData[transitionIndex].type !== "transition"
    ) {
      transitionIndex--;
    }
    state.stepIndex = transitionIndex;
  }

  startStep(state);
  stopStepTimer(state);
};

// --- INITIALIZATION ---

const initializeEditor = () => {
  const savedWorkout = localStorage.getItem("workoutText");
  if (savedWorkout) {
    DOM.inputText.value = savedWorkout;
  }
};

// Call on page load
initializeEditor();

// Module-level state
/** @type {State} */
let state = initState([]);
let voice = initVoice();
let wakeLock = null;
let audioUnlocked = false;

// Initialize voice
if (window.speechSynthesis.onvoiceschanged !== undefined) {
  window.speechSynthesis.onvoiceschanged = initVoice;
}

// Event listeners
DOM.startBtn.addEventListener("click", () => {
  startWorkout();
});

DOM.stopBtn.addEventListener("click", () => {
  transitionToEditing(state);
});

DOM.playPauseBtn.addEventListener("click", () => {
  togglePause(state);
});

DOM.prevBtn.addEventListener("click", () => {
  prevStep(state);
});

DOM.nextBtn.addEventListener("click", () => {
  nextStep(state);
});
