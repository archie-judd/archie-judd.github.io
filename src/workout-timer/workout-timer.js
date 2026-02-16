// @ts-check
// --- CONSTANTS ---

const STATUS = {
  EDITING: "editing",
  IN_PROGRESS: "in_progress",
  PAUSED: "paused",
  DONE: "done",
};

const CHANGE_EXERCISE_TRANSITION_S = 6;
const CHANGE_SIDES_TRANSITION_S = 6;
const ERROR_BANNER_AUTO_HIDE_MS = 8000;
const HALFWAY_ANNOUNCEMENT_MIN_DURATION_S = 20;
const STEP_JUST_STARTED_THRESHOLD_S = 2;
const TICK_INTERVAL_MS = 250;
const STORAGE_KEY_WORKOUTS = "workoutTexts";

const DEFAULT_WORKOUT = `# My Workout
## Warm Up
Jumping Jacks | 30s
Rest | 10s

## Main Set
Push-ups | 45s // chest to floor
Rest | 30s
Lunges | 60 | each side

## Cool Down
Stretching | 2m`;

// --- TYPE DEFINITIONS ---

/**
 * @typedef {Object} Exercise
 * @property {"exercise"} type
 * @property {string} name
 * @property {Volume} volume
 * @property {"left" | "right" | "each" | null} side
 * @property {string | null} notes
 * @property {string | null} section
 */

/**
 * @typedef {Object} Rest
 * @property {"rest"} type
 * @property {number} durationSeconds
 * @property {string | null} notes
 * @property {string | null} section
 */

/**
 * @typedef {Object} Volume
 * @property {number} value
 * @property {"seconds" | "reps"} unit
 */

/**
 * @typedef {Object} Transition
 * @property {"transition"} type
 * @property {"changeSides" | "changeExercises"} kind
 * @property {number} durationSeconds
 * @property {string | null} section
 */

/**
 * @typedef {Object} WorkoutData
 * @property {string | null} title
 * @property {(Exercise | Transition | Rest)[]} steps
 */

/**
 * @typedef {Object} ParsedEmpty
 * @property {"empty"} type
 */

/**
 * @typedef {Object} ParsedTitle
 * @property {"title"} type
 * @property {string} name
 */

/**
 * @typedef {Object} ParsedHeader
 * @property {"header"} type
 * @property {string} name
 */

/**
 * @typedef {Object} ParsedExercise
 * @property {"exercise"} type
 * @property {string} name
 * @property {Volume} volume
 * @property {string|null} modifier
 * @property {string|null} notes
 * @property {string[]} parts
 */

/**
 * @typedef {Object} ParsedRest
 * @property {"rest"} type
 * @property {Volume} volume
 * @property {string|null} notes
 * @property {string[]} parts
 */

/**
 * @typedef {Object} ParsedError
 * @property {"error"} type
 * @property {string} msg
 * @property {"lineFormat"|"duration"|"modifier"} [kind]
 * @property {"rest" | "exercise" | null} stepType
 */

/**
 * @typedef {ParsedEmpty | ParsedTitle | ParsedHeader | ParsedExercise | ParsedRest | ParsedError} ParsedLine
 */

/**
 * @typedef {Object} State
 * @property {string} status
 * @property {WorkoutData} workoutData
 * @property {number} stepIndex
 * @property {number} stepDuration - Total duration of current step in seconds
 * @property {number} stepElapsedMs - Accumulated step elapsed time in ms (frozen on pause)
 * @property {number} stepResumedAt - Timestamp when step last started/Resumed (0 if not ticking)
 * @property {boolean} stepAnnounced - Whether we've announced the current step (to avoid repeats on Resume)
 * @property {number} stepEntryTime - Timestamp when step was entered (before speech)
 * @property {number} workoutStartTime - Timestamp when workout started
 * @property {number} totalPausedMs - Accumulated pause time in ms
 * @property {number} pauseStartTime - Timestamp when current pause began (0 if not paused)
 * @property {number} lastAnnouncedSecond - Last second value we announced (to avoid repeats)
 * @property {NodeJS.Timeout|null} mainTimer - Single interval driving all updates
 */

// --- DOM REFERENCES ---
const DOM = {
  editorView: document.getElementById("editor-view"),
  workoutView: document.getElementById("workout-view"),
  inputText: /** @type {HTMLTextAreaElement} */ (
    document.getElementById("input-text")
  ),
  overlay: document.getElementById("highlightOverlay"),
  stopBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("stop-btn")
  ),
  muteBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("mute-btn")
  ),
  elapsedTime: document.getElementById("elapsed-time"),
  displayContainer: document.getElementById("display-container"),
  sectionIndicator: document.getElementById("section-indicator"),
  exerciseGetReady: document.getElementById("exercise-get-ready"),
  exerciseName: document.getElementById("exercise-name"),
  exerciseDetail: document.getElementById("exercise-detail"),
  timerDisplay: document.getElementById("timer-display"),
  nextIndicator: document.getElementById("next-indicator"),
  playPauseBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("play-pause-btn")
  ),
  progressBarContainer: document.getElementById("progress-bar-container"),
  progressBar: document.getElementById("progress-bar"),
  startBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("start-btn")
  ),
  prevBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("prev-btn")
  ),
  nextBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("next-btn")
  ),
  errorBanner: document.getElementById("error-banner"),
  newWorkoutBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("new-workout-btn")
  ),
  editorSectionIndicator: document.getElementById("editor-section-indicator"),
  editorPrevBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("editor-prev-btn")
  ),
  editorNextBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("editor-next-btn")
  ),
  deleteWorkoutBtn: /** @type {HTMLButtonElement} */ (
    document.getElementById("delete-workout-btn")
  ),
};

// --- ERROR HANDLING ---

/** @param {string} message */
const showError = (message) => {
  DOM.errorBanner.innerText = message;
  DOM.errorBanner.style.display = "block";
  setTimeout(hideError, ERROR_BANNER_AUTO_HIDE_MS);
};

const hideError = () => {
  DOM.errorBanner.style.display = "none";
};

// --- SYNTAX HIGHLIGHTING ---

/**
 * @param {string} text
 * @returns {string}
 */
const escapeHtml = (text) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

/**
 * @param {string} line
 * @param {ParsedExercise | ParsedRest | ParsedError} parsed
 * @returns {string}
 */
const highlightExerciseOrRestLine = (line, parsed) => {
  const commentIndex = line.indexOf("//");
  const mainPart = commentIndex >= 0 ? line.substring(0, commentIndex) : line;
  const commentPart = commentIndex >= 0 ? line.substring(commentIndex) : "";
  const rawParts = mainPart.split("|");

  let durationClass = "syntax-duration";
  let modifierClass = "syntax-modifier";
  if (parsed.type === "error") {
    if (parsed.kind === "duration") {
      durationClass = "syntax-error";
    }
    if (parsed.kind === "modifier") {
      modifierClass = "syntax-error";
    }
  }

  let result = "";
  if (parsed.type === "exercise") {
    result += `<span class="syntax-exercise">${escapeHtml(rawParts[0])}</span>`;
  } else if (parsed.type === "rest") {
    result += `<span class="syntax-rest">${escapeHtml(rawParts[0])}</span>`;
  } else if (parsed.stepType === "exercise") {
    result += `<span class="syntax-exercise">${escapeHtml(rawParts[0])}</span>`;
  } else if (parsed.stepType === "rest") {
    result += `<span class="syntax-rest">${escapeHtml(rawParts[0])}</span>`;
  }

  result += `<span class="syntax-separator">|</span>`;
  result += `<span class="${durationClass}">${escapeHtml(rawParts[1])}</span>`;
  if (rawParts[2] !== undefined) {
    result += `<span class="syntax-separator">|</span>`;
    result += `<span class="${modifierClass}">${escapeHtml(rawParts[2])}</span>`;
  }
  if (commentPart) {
    result += `<span class="syntax-comment">${escapeHtml(commentPart)}</span>`;
  }
  return result;
};

/**
 * Highlight a single line of workout text.
 * @param {string} line
 * @param {boolean} isCursorLine - true if the cursor is on this line (suppresses error styling)
 * @param {number} lineIndex - 0-based line index
 * @returns {string} HTML string
 */
const highlightLine = (line, isCursorLine, lineIndex) => {
  if (line === "") return "";
  const parsed = parseLine(line, lineIndex);

  if (parsed.type === "empty") {
    return `<span class="syntax-comment">${escapeHtml(line)}</span>`;
  }
  if (parsed.type === "title") {
    return `<span class="syntax-header">${escapeHtml(line)}</span>`;
  }
  if (parsed.type === "header") {
    return `<span class="syntax-section">${escapeHtml(line)}</span>`;
  }
  if (parsed.type === "error" && parsed.kind == "lineFormat") {
    if (isCursorLine) return escapeHtml(line);
    return `<span class="syntax-error">${escapeHtml(line)}</span>`;
  }

  return highlightExerciseOrRestLine(line, parsed);
};

function updateHighlightOverlay() {
  const text = DOM.inputText.value;
  const cursorLine =
    text.substring(0, DOM.inputText.selectionStart).split("\n").length - 1;
  const lines = text.split("\n");
  DOM.overlay.innerHTML = lines
    .map((line, i) => highlightLine(line, i === cursorLine, i))
    .join("<br>");
  DOM.overlay.scrollTop = DOM.inputText.scrollTop;
}

function syncOverlayScroll() {
  DOM.overlay.scrollTop = DOM.inputText.scrollTop;
  DOM.overlay.scrollLeft = DOM.inputText.scrollLeft;
}

DOM.inputText.addEventListener("scroll", syncOverlayScroll);

DOM.inputText.addEventListener("input", () => {
  saveCurrentWorkoutText();
  updateHighlightOverlay();
});

// --- AUDIO/SPEECH ---

const ensureSpeechUnlocked = () => {
  if (!window.speechSynthesis) {
    throw new Error("Speech Synthesis API not supported in this browser.");
  }
  if (!window.speechSynthesis.speaking && !audioUnlocked) {
    const utterance = new SpeechSynthesisUtterance(" ");
    window.speechSynthesis.speak(utterance);
    audioUnlocked = true;
  }
};

document.addEventListener(
  "click",
  () => {
    try {
      ensureSpeechUnlocked();
    } catch (_) {}
  },
  { once: true },
);

const loadVoice = () => {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    voice =
      voices.find((v) => v.name === "Samantha") ||
      voices.find((v) => v.name === "Google US English") ||
      voices.find((v) => v.lang === "en-US") ||
      voices.find((v) => v.lang.startsWith("en")) ||
      voices[0];
  }
};

/**
 * Speak text aloud, optionally with a pause before speaking.
 * @param {string} text
 * @param {number | null} pauseBeforeMs
 * @param {function(): boolean} [cancelOn] - Optional function to cancel speech early
 */
const speak = async (text, pauseBeforeMs = null, cancelOn = null) => {
  if (pauseBeforeMs !== null) {
    await new Promise((r) => setTimeout(r, pauseBeforeMs));
  }
  if (cancelOn !== null) {
    if (cancelOn() === true) {
      return;
    }
  }
  if (isMuted) return;
  return new Promise((resolve) => {
    if (!voice) console.warn("No voice available for speech synthesis.");

    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    const checkInterval = setInterval(() => {
      if ((cancelOn !== null && cancelOn() === true) || isMuted) {
        window.speechSynthesis.cancel();
        setTimeout(() => window.speechSynthesis.cancel(), 0);
        clearInterval(checkInterval);
        resolve(undefined);
      }
    }, 100); // Check every 100ms
    utterance.onend = () => {
      clearInterval(checkInterval);
      resolve(undefined);
    };
    utterance.onerror = (error) => {
      console.warn("Speech synthesis error:", error);
      clearInterval(checkInterval);
      resolve(undefined);
    };
    speechSynthesis.speak(utterance);
  });
};

/**
 * Speak a sequence of texts, chained sequentially with pauses between them.
 * Returns immediately (fire-and-forget). Cancelled via the cancelOn callback.
 * @param {Array<{ text: string, pauseBeforeMs: number | null }>} parts
 * @param {function(): boolean} [cancelOn]
 */
const speakSequence = async (parts, cancelOn = null) => {
  for (const part of parts) {
    await speak(part.text, part.pauseBeforeMs, cancelOn);
    if (cancelOn?.() === true) return;
  }
};

const cancelSpeech = () => {
  if (window.speechSynthesis) {
    // iOS Safari requires multiple cancel calls and a small delay
    window.speechSynthesis.cancel();
    setTimeout(() => window.speechSynthesis.cancel(), 0);
  }
};

/** Cancel speech without a deferred cancel, for use when new speech will be
 *  queued immediately after (avoids the deferred cancel killing the new speech). */
const cancelSpeechForNewSpeech = () => {
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
};

// --- TIME FORMATTING ---

/** @param {number} seconds */
const formatCountdown = (seconds) => {
  if (seconds < 60) return seconds.toString();
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/** @param {number} seconds */
const formatDurationForSpeech = (seconds) => {
  if (seconds < 60) return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const minPart = `${m} ${m === 1 ? "minute" : "minutes"}`;
  if (s === 0) return minPart;
  return `${minPart} and ${s} ${s === 1 ? "second" : "seconds"}`;
};

/** @param {number} totalSeconds */
const formatElapsedTime = (totalSeconds) => {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

// --- WORKOUT PARSER ---

/**
 * Parse a duration/volume string into a structured Volume.
 * @param {string} duration
 * @returns {Volume}
 */
const parseVolume = (duration) => {
  duration = duration.trim();

  if (/^\d+$/.test(duration)) {
    return { value: parseInt(duration), unit: "reps" };
  }

  if (/^\d+\s*reps?$/.test(duration)) {
    return { value: parseInt(duration), unit: "reps" };
  }

  const combinedMatch = duration.match(
    /^(\d+)\s*m(?:in(?:ute)?s?)?\s*(\d+)\s*s(?:ec(?:ond)?s?)?$/,
  );
  if (combinedMatch) {
    return {
      value: parseInt(combinedMatch[1]) * 60 + parseInt(combinedMatch[2]),
      unit: "seconds",
    };
  }

  if (duration.includes(",")) {
    const parts = duration.split(",").map((p) => p.trim());
    let total = 0;
    for (const part of parts) {
      if (part.includes(","))
        throw new Error(`Invalid nested commas in duration: "${duration}"`);
      const parsed = parseVolume(part);
      if (parsed.unit !== "seconds")
        throw new Error(`Cannot combine reps with time in: "${duration}"`);
      total += parsed.value;
    }
    return { value: total, unit: "seconds" };
  }

  const simpleMatch = duration.match(
    /^(\d+)\s*(s(?:ec(?:ond)?s?)?|m(?:in(?:ute)?s?)?)$/,
  );
  if (simpleMatch) {
    const val = parseInt(simpleMatch[1]);
    return simpleMatch[2].startsWith("m")
      ? { value: val * 60, unit: "seconds" }
      : { value: val, unit: "seconds" };
  }

  throw new Error(
    `Invalid duration or reps: "${duration}". Expected formats: "10" (reps), "30s", "30 sec", "2m", "2 min", "1m30s", "1 minute, 30 seconds"`,
  );
};

/**
 * @param {string} line
 * @param {number} [lineIndex=1] - 0-based line index in the document
 * @returns {ParsedLine}
 */
const parseLine = (line, lineIndex = 1) => {
  const trimmed = line.trim();

  if (trimmed === "" || trimmed.startsWith("//")) return { type: "empty" };

  if (trimmed.startsWith("#")) {
    const hashMatch = trimmed.match(/^(#+)\s*(.*)/);
    if (!hashMatch) return { type: "empty" };
    const hashes = hashMatch[1];
    const name = hashMatch[2].trim();

    if (hashes.length > 2) {
      return {
        type: "error",
        msg: `Too many # characters. Use # for title, ## for section`,
        kind: "lineFormat",
        stepType: null,
      };
    }

    if (!name.length) {
      return {
        type: "error",
        msg: "Empty header",
        kind: "lineFormat",
        stepType: null,
      };
    }

    if (hashes.length === 1) {
      if (lineIndex !== 0) {
        return {
          type: "error",
          msg: `Title (#) must be on the first line. Use ## for sections`,
          kind: "lineFormat",
          stepType: null,
        };
      }
      return { type: "title", name };
    }

    return { type: "header", name };
  }

  const commentIndex = line.indexOf("//");
  const mainPart = commentIndex >= 0 ? line.substring(0, commentIndex) : line;
  const notes =
    commentIndex >= 0 ? line.substring(commentIndex + 2).trim() : null;
  const parts = mainPart.split("|").map((s) => s.trim());

  if (parts.length < 2 || parts.length > 3) {
    return {
      type: "error",
      msg: `Expected 2-3 parts, got ${parts.length}`,
      kind: "lineFormat",
      stepType: null,
    };
  }

  const [name, durationStr, modifier] = parts;
  const isRest = name.toLowerCase().trim() === "rest";

  let volume = null;
  try {
    volume = parseVolume(durationStr);
  } catch (e) {
    return {
      type: "error",
      msg: e.message,
      kind: "duration",
      stepType: isRest ? "rest" : "exercise",
    };
  }

  if (isRest) {
    if (volume.unit === "reps") {
      return {
        type: "error",
        msg: `Rest cannot have reps as volume. Expected time format like "30s", "1m", "1m30s", or "1 minute, 30 seconds".`,
        kind: "duration",
        stepType: "rest",
      };
    } else if (modifier !== undefined) {
      return {
        type: "error",
        msg: `Rest cannot have a modifier (like "each side")`,
        kind: "modifier",
        stepType: "rest",
      };
    } else {
      return { type: "rest", volume, notes, parts };
    }
  }

  if (modifier && modifier !== "each side") {
    return {
      type: "error",
      msg: `Invalid modifier: "${modifier}"`,
      kind: "modifier",
      stepType: "exercise",
    };
  }

  return {
    type: "exercise",
    name,
    volume,
    modifier: modifier || null,
    notes,
    parts,
  };
};

/**
 * Expand a parsed line into steps, stamped with the current section.
 * @param {string} line
 * @param {number} lineIndex
 * @param {string | null} section
 * @returns {(Exercise | Transition | Rest)[]}
 */
const expandLineToSteps = (line, lineIndex, section) => {
  const parsed = parseLine(line, lineIndex);

  if (
    parsed.type === "empty" ||
    parsed.type === "title" ||
    parsed.type === "header"
  )
    return [];
  if (parsed.type === "error") throw new Error(parsed.msg);

  if (parsed.type === "rest") {
    return [
      {
        type: "rest",
        durationSeconds: parsed.volume.value,
        notes: parsed.notes,
        section,
      },
    ];
  }

  const { name, volume, modifier, notes } = parsed;

  if (modifier === "each side") {
    if (parsed.volume.unit === "reps") {
      // Rep-based exercises don't need transitions - announcement happens in the exercise step
      return [{ type: "exercise", name, volume, side: "each", notes, section }];
    } else {
      return [
        {
          type: "transition",
          kind: "changeExercises",
          durationSeconds: CHANGE_EXERCISE_TRANSITION_S,
          section,
        },
        { type: "exercise", name, volume, side: "left", notes, section },
        {
          type: "transition",
          kind: "changeSides",
          durationSeconds: CHANGE_SIDES_TRANSITION_S,
          section,
        },
        { type: "exercise", name, volume, side: "right", notes, section },
      ];
    }
  }

  // Rep-based exercises don't need transitions - announcement happens in the exercise step
  if (parsed.volume.unit === "reps") {
    return [{ type: "exercise", name, volume, side: null, notes, section }];
  }

  // Time-based exercises get a transition
  return [
    {
      type: "transition",
      kind: "changeExercises",
      durationSeconds: CHANGE_EXERCISE_TRANSITION_S,
      section,
    },
    { type: "exercise", name, volume, side: null, notes, section },
  ];
};

/**
 * Parse workout text into a WorkoutData structure.
 * @param {string} text
 * @returns {WorkoutData}
 */
const parseWorkout = (text) => {
  const lines = text.split("\n");
  /** @type {(Exercise | Transition | Rest)[]} */
  const steps = [];
  const errors = [];
  /** @type {string | null} */
  let title = null;
  /** @type {string | null} */
  let currentSection = null;

  lines.forEach((line, index) => {
    const parsed = parseLine(line, index);

    if (parsed.type === "title") {
      title = parsed.name;
      return;
    }
    if (parsed.type === "header") {
      currentSection = parsed.name;
      return;
    }

    try {
      steps.push(...expandLineToSteps(line, index, currentSection));
    } catch (error) {
      errors.push(`Line ${index + 1}: ${error.message}`);
    }
  });

  if (errors.length > 0) throw new Error(errors.join("\n"));
  return { title, steps };
};

// --- WORKOUT UTILITIES ---

/** @param {State} state */
const findNextExerciseOrRest = (state) => {
  for (let i = state.stepIndex + 1; i < state.workoutData.steps.length; i++) {
    const s = state.workoutData.steps[i];
    if (s.type === "exercise" || s.type === "rest") return s;
  }
  return null;
};

/** @param {State} state
 * @return {Exercise | Transition | Rest | null} */
const getCurrentStep = (state) => state.workoutData.steps[state.stepIndex];

/**
 * Get the step duration for a given step.
 * @param {Exercise | Transition | Rest} step
 * @returns {number}
 */
const getStepDuration = (step) => {
  if (step.type === "transition") return step.durationSeconds;
  if (step.type === "exercise")
    return step.volume.unit === "seconds" ? step.volume.value : 0;
  if (step.type === "rest") return step.durationSeconds;
  return 0;
};

// --- DERIVED TIME HELPERS ---

/**
 * Get total step elapsed in ms, combining the frozen accumulator
 * with live time since last Resume.
 * @param {State} state
 */
const getStepElapsedMs = (state) => {
  if (state.stepResumedAt === 0) return state.stepElapsedMs;
  return state.stepElapsedMs + (Date.now() - state.stepResumedAt);
};

/** @param {State} state */
const getStepTimeLeftS = (state) =>
  Math.max(0, state.stepDuration - Math.floor(getStepElapsedMs(state) / 1000));

/** @param {State} state */
const getWorkoutElapsedS = (state) => {
  if (state.workoutStartTime === 0) return 0;
  const now =
    state.status === STATUS.PAUSED ? state.pauseStartTime : Date.now();
  return Math.floor(
    (now - state.workoutStartTime - state.totalPausedMs) / 1000,
  );
};

// --- STATE INITIALIZATION ---

/** @returns {State} */
const createInitialState = () => ({
  status: STATUS.EDITING,
  workoutData: { title: null, steps: [] },
  stepResumedAt: 0,
  stepElapsedMs: 0,
  stepEntryTime: 0,
  stepIndex: 0,
  stepDuration: 0,
  stepAnnounced: false,
  workoutStartTime: 0,
  totalPausedMs: 0,
  pauseStartTime: 0,
  lastAnnouncedSecond: -1,
  mainTimer: null,
});

// --- SINGLE TIMER ---

/** @param {State} state */
const startTickTimer = (state) => {
  stopTickTimer(state);
  state.mainTimer = setInterval(() => onTimerTick(state), TICK_INTERVAL_MS);
};

/** @param {State} state */
const stopTickTimer = (state) => {
  if (state.mainTimer) {
    clearInterval(state.mainTimer);
    state.mainTimer = null;
  }
};

/** @param {State} state */
const onTimerTick = (state) => {
  try {
    if (state.status !== STATUS.IN_PROGRESS) return;

    if (state.stepResumedAt === 0) {
      updateDisplay(state);
      return;
    }

    const timeLeft = getStepTimeLeftS(state);

    if (timeLeft !== state.lastAnnouncedSecond) {
      state.lastAnnouncedSecond = timeLeft;
      announceCountdownIfNeeded(state, timeLeft);
    }

    updateDisplay(state);

    if (state.stepDuration > 0 && timeLeft <= 0) {
      advanceToNextStep(state);
    }
  } catch (error) {
    console.error("Timer error:", error);
    showError(`Timer error: ${error.message}`);
    transitionToEditing(state);
  }
};

/**
 * Speak countdown numbers and halfway announcements as appropriate.
 * @param {State} state
 * @param {number} timeLeft
 */
const announceCountdownIfNeeded = async (state, timeLeft) => {
  const step = getCurrentStep(state);

  if (step.type === "transition") {
    if (timeLeft <= 3 && timeLeft > 0) {
      window.speechSynthesis.cancel();
      speak(timeLeft.toString());
      return;
    }
  } else {
    const duration =
      step.type === "rest"
        ? step.durationSeconds
        : step.volume.unit === "seconds"
          ? step.volume.value
          : null;

    if (duration !== null) {
      const halfwayPoint = Math.floor(duration / 2);
      if (
        duration >= HALFWAY_ANNOUNCEMENT_MIN_DURATION_S &&
        timeLeft === halfwayPoint
      ) {
        speakSequence(
          [
            { text: "Halfway there", pauseBeforeMs: null },
            {
              text: `${formatDurationForSpeech(halfwayPoint)} left`,
              pauseBeforeMs: 400,
            },
          ],
          () => state.status !== STATUS.IN_PROGRESS,
        );
      }
    }

    if (timeLeft <= 3 && timeLeft > 0) {
      window.speechSynthesis.cancel();
      speak(
        timeLeft.toString(),
        null,
        () => state.status !== STATUS.IN_PROGRESS,
      );
    }
  }
};

// --- DISPLAY UPDATES ---

/** @param {State} state */
const computeProgressPercent = (state) => {
  if (state.status === STATUS.DONE) return 100;
  const total = state.workoutData.steps.filter(
    (s) => s.type === "exercise",
  ).length;
  if (total === 0) return 0;
  const done = state.workoutData.steps
    .slice(0, state.stepIndex)
    .filter((s) => s.type === "exercise").length;
  return Math.min((done / total) * 100, 100);
};

const displayEditing = () => {
  DOM.editorView.style.display = "flex";
  DOM.workoutView.style.display = "none";
  DOM.displayContainer.dataset.tappable = "false";
  DOM.startBtn.disabled = false;
  updateEditorUI();
};

/** @param {State} state */
const formatNextStepLabel = (state) => {
  const next = findNextExerciseOrRest(state);
  if (!next) return "Next: Finish";
  if (next.type === "rest") return "Next: Rest";
  if (next.type === "exercise") {
    return next.side
      ? `Next: ${next.name} (${next.side} side)`
      : `Next: ${next.name}`;
  }
  return "";
};

/** @param {State} state */
const updateSectionDisplay = (state) => {
  if (!DOM.sectionIndicator) return;
  const step = getCurrentStep(state);
  const section = step ? step.section : null;
  const title = state.workoutData.title;

  let display = "";
  if (title && section) {
    display = `${title} — ${section}`;
  } else if (title) {
    display = title;
  } else if (section) {
    display = section;
  }

  if (display) {
    DOM.sectionIndicator.innerText = display;
    DOM.sectionIndicator.style.display = "block";
  } else {
    DOM.sectionIndicator.innerText = "";
    DOM.sectionIndicator.style.display = "none";
  }
};

/**
 * Sets common workout-view layout and button states.
 * @param {State} state
 */
const applyWorkoutViewDefaults = (state) => {
  DOM.editorView.style.display = "none";
  DOM.workoutView.style.display = "flex";
  DOM.playPauseBtn.disabled = false;
  DOM.nextBtn.disabled = false;
  DOM.prevBtn.disabled = false;
  DOM.stopBtn.disabled = false;
  DOM.elapsedTime.innerText = formatElapsedTime(getWorkoutElapsedS(state));
  DOM.progressBar.style.width = `${computeProgressPercent(state)}%`;
  DOM.progressBarContainer.style.display = "block";
  DOM.timerDisplay.style.display = "block";
  updateSectionDisplay(state);
};

/**
 * @param {State} state
 * @param {Transition} step
 */
const displayTransitionStep = (state, step) => {
  DOM.displayContainer.className = "main-display state-transition";
  DOM.exerciseGetReady.innerText =
    step.kind === "changeSides" ? "Switch sides" : "Get Ready";
  DOM.nextIndicator.innerText = "Tap to skip";
  DOM.timerDisplay.innerText = formatCountdown(getStepTimeLeftS(state));
  DOM.displayContainer.dataset.tappable = "true";
  DOM.playPauseBtn.innerText = "Pause";

  const next = findNextExerciseOrRest(state);
  if (next?.type === "exercise") {
    DOM.exerciseName.innerText = next.name;
    DOM.exerciseDetail.innerText =
      next.side !== null ? `(${next.side} side)` : "";
  } else if (next?.type === "rest") {
    DOM.exerciseName.innerText = "Rest";
    DOM.exerciseDetail.innerText = "";
  }
};

/**
 * @param {State} state
 * @param {Exercise | Rest} step
 */
const displayActiveStep = (state, step) => {
  DOM.displayContainer.className = "main-display state-work";
  DOM.exerciseGetReady.innerText = "";
  DOM.nextIndicator.innerText = formatNextStepLabel(state);
  DOM.displayContainer.dataset.tappable = "false";

  if (step.type === "rest") {
    DOM.exerciseName.innerText = "Rest";
    DOM.exerciseDetail.innerText = "";
    DOM.timerDisplay.innerText = formatCountdown(getStepTimeLeftS(state));
  } else {
    DOM.exerciseName.innerText = step.name;
    DOM.exerciseDetail.innerText =
      step.side !== null ? `(${step.side} side)` : "";

    if (step.volume.unit === "reps") {
      DOM.timerDisplay.innerText = step.volume.value.toString();
      DOM.displayContainer.dataset.tappable = "true";
    } else {
      DOM.timerDisplay.innerText = formatCountdown(getStepTimeLeftS(state));
    }
  }
};

/** @param {State} state */
const displayDone = (state) => {
  updateSectionDisplay(state);
  DOM.displayContainer.className = "main-display state-done";
  DOM.exerciseGetReady.innerText = "";
  DOM.exerciseName.innerText = "Workout Complete!";
  DOM.exerciseDetail.innerText = "";
  DOM.nextIndicator.innerText = "";
  DOM.timerDisplay.style.display = "block";
  DOM.timerDisplay.innerText = "00";
  DOM.progressBar.style.width = "100%";
  DOM.progressBarContainer.style.display = "none";
  DOM.playPauseBtn.disabled = false;
  DOM.playPauseBtn.innerText = "Back";
  DOM.nextBtn.disabled = true;
  DOM.prevBtn.disabled = true;
  DOM.stopBtn.disabled = true;
  DOM.editorView.style.display = "none";
  DOM.workoutView.style.display = "flex";
  DOM.displayContainer.dataset.tappable = "false";
};

/** @param {State} state */
const displayInProgress = (state) => {
  const step = getCurrentStep(state);
  applyWorkoutViewDefaults(state);

  if (step.type === "transition") displayTransitionStep(state, step);
  else if (step.type === "exercise" || step.type === "rest")
    displayActiveStep(state, step);
  DOM.playPauseBtn.innerText = "Pause";
};

/** @param {State} state */
const displayPaused = (state) => {
  displayInProgress(state);
  DOM.displayContainer.className = "main-display state-paused";
  DOM.playPauseBtn.innerText = "Resume";
};

/** @param {State} state */
const updateDisplay = (state) => {
  switch (state.status) {
    case STATUS.EDITING:
      displayEditing();
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

// --- SCREEN WAKE LOCK ---

const acquireScreenWakeLock = async () => {
  try {
    // Modern browsers with Wake Lock API
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    } else if (noSleepVideo && noSleepVideo.paused) {
      try {
        await noSleepVideo.play();
      } catch (e) {
        console.warn("Failed to play NoSleep video:", e);
      }
    } else {
    }
  } catch (err) {
    console.warn("Wake Lock ignored:", err);
  }
};

const releaseScreenWakeLock = () => {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
  if (noSleepVideo && !noSleepVideo.paused) {
    noSleepVideo.pause();
  }
};

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    state.status === STATUS.IN_PROGRESS
  ) {
    acquireScreenWakeLock();
  }
});

// --- WORKFLOW CONTROL ---

const startWorkout = async () => {
  hideError();
  saveCurrentWorkoutText();
  state.workoutData = parseWorkout(DOM.inputText.value);

  if (state.workoutData.steps.length === 0) {
    throw new Error(
      "No valid workout steps found. Please enter at least one step.",
    );
  }

  acquireScreenWakeLock(); // Don't await - let it happen in background
  beginWorkoutFromStart(state);
};

/** @param {State} state */
const beginWorkoutFromStart = (state) => {
  state.stepIndex = 0;
  state.status = STATUS.IN_PROGRESS;
  state.workoutStartTime = Date.now();
  state.totalPausedMs = 0;
  state.pauseStartTime = 0;
  state.stepElapsedMs = 0;
  state.stepResumedAt = 0;

  if (state.stepIndex < state.workoutData.steps.length) {
    state.stepDuration = getStepDuration(
      state.workoutData.steps[state.stepIndex],
    );
  }

  updateDisplay(state);
  startTickTimer(state);
  enterCurrentStep(state);
};

/** @param {State} state */
const transitionToEditing = (state) => {
  stopTickTimer(state);
  cancelSpeech();
  releaseScreenWakeLock();
  state.status = STATUS.EDITING;
  updateDisplay(state);
};

/** @param {State} state */
const finishWorkout = (state) => {
  state.status = STATUS.DONE;
  state.stepIndex = state.workoutData.steps.length - 1;
  stopTickTimer(state);
  speak("Workout Complete");
  updateDisplay(state);
};

// --- STEP MANAGEMENT ---

/**
 * Announce the current step with speech (without resetting step state)
 * @param {State} state
 */
const announceCurrentStep = async (state) => {
  const entryTimestamp = state.stepEntryTime;
  const step = getCurrentStep(state);
  const cancelOn = () =>
    !isStillOnStep(state, entryTimestamp) ||
    state.status !== STATUS.IN_PROGRESS;

  const titleParts =
    state.stepIndex === 0 && state.workoutData.title
      ? [{ text: state.workoutData.title, pauseBeforeMs: null }]
      : [];

  // Check if section changed from previous step
  const prevStep =
    state.stepIndex > 0 ? state.workoutData.steps[state.stepIndex - 1] : null;
  const sectionChanged = !prevStep || prevStep.section !== step.section;
  const sectionParts =
    sectionChanged && step.section
      ? [
          {
            text: step.section,
            pauseBeforeMs: titleParts.length > 0 ? 400 : null,
          },
        ]
      : [];

  const speechParts = buildStepSpeechParts(step, state);
  const noteParts =
    (step.type === "exercise" || step.type === "rest") && step.notes
      ? [{ text: step.notes, pauseBeforeMs: 500 }]
      : [];

  // For transitions, speak the announcement first (blocking), then start countdown timer
  if (step.type === "transition") {
    await speakSequence(
      [...titleParts, ...sectionParts, ...speechParts, ...noteParts],
      cancelOn,
    );

    // After speech completes, start the countdown timer
    if (
      isStillOnStep(state, entryTimestamp) &&
      state.status === STATUS.IN_PROGRESS
    ) {
      state.stepResumedAt = Date.now();
      state.stepElapsedMs = 0;
      state.lastAnnouncedSecond = -1;
      if (!state.mainTimer) startTickTimer(state);
    }
  } else {
    // For exercises and rest, start timer immediately and speak in parallel
    state.stepResumedAt = Date.now();
    speakSequence(
      [...titleParts, ...sectionParts, ...speechParts, ...noteParts],
      cancelOn,
    );
    if (!state.mainTimer) startTickTimer(state);
  }

  state.stepAnnounced = true;
};

/**
 * Initialize and enter the step at the current stepIndex.
 * @param {State} state
 */
const enterCurrentStep = (state) => {
  if (state.stepIndex >= state.workoutData.steps.length) {
    finishWorkout(state);
    return;
  }

  if (state.status === STATUS.EDITING || state.status === STATUS.DONE) {
    return;
  }

  state.stepEntryTime = Date.now();
  const step = getCurrentStep(state);
  state.stepElapsedMs = 0;
  state.stepAnnounced = false;
  state.lastAnnouncedSecond = -1;
  state.stepDuration = getStepDuration(step);

  // For transitions, don't start timer yet - announceCurrentStep will start it after speech
  // For exercises/rest, start timer immediately
  if (step.type === "transition") {
    state.stepResumedAt = 0;
  } else {
    state.stepResumedAt = Date.now();
  }

  updateDisplay(state);

  if (state.status === STATUS.IN_PROGRESS) {
    announceCurrentStep(state);
  }
};

/**
 * @param {State} state
 * @param {number} entryTimestamp
 */
const isStillOnStep = (state, entryTimestamp) =>
  state.stepEntryTime === entryTimestamp &&
  state.status !== STATUS.DONE &&
  state.status !== STATUS.EDITING;

/**
 * Build an array of speech instructions for a step.
 * @param {Exercise | Transition | Rest} step
 * @param {State} state
 * @returns {Array<{ text: string, pauseBeforeMs: number | null }>}
 */
const buildStepSpeechParts = (step, state) => {
  if (step.type === "transition") {
    const next = findNextExerciseOrRest(state);
    if (next?.type === "exercise") {
      let sideSuffix;
      if (step.kind === "changeSides") {
        sideSuffix = `the ${next.side} side`;
      } else if (next.side === "left" || next.side === "right") {
        sideSuffix = `${next.name} on the ${next.side} side`;
      } else {
        sideSuffix = next.name;
      }
      const prefix =
        step.kind === "changeSides" ? "Switch to" : "Get ready for";
      return [{ text: `${prefix} ${sideSuffix}`, pauseBeforeMs: null }];
    }
    return [];
  }

  if (step.type === "exercise") {
    if (step.volume.unit === "reps") {
      let sideSuffix = "";
      if (step.side === "each") {
        sideSuffix = " on each side";
      }
      return [
        {
          text: step.name,
          pauseBeforeMs: null,
        },
        {
          text: `${step.volume.value} reps${sideSuffix}`,
          pauseBeforeMs: 400,
        },
        { text: "Go!", pauseBeforeMs: 400 },
        { text: "Tap when done", pauseBeforeMs: 400 },
      ];
    }
    return [
      { text: formatDurationForSpeech(step.volume.value), pauseBeforeMs: 300 },
      { text: "Go!", pauseBeforeMs: 400 },
    ];
  }

  if (step.type === "rest") {
    return [
      { text: "Rest for", pauseBeforeMs: null },
      {
        text: formatDurationForSpeech(step.durationSeconds),
        pauseBeforeMs: 400,
      },
    ];
  }

  return [];
};

/** @param {State} state */
const advanceToNextStep = (state) => {
  cancelSpeechForNewSpeech();
  state.stepIndex++;
  if (state.stepIndex >= state.workoutData.steps.length) {
    finishWorkout(state);
  } else {
    enterCurrentStep(state);
  }
};

// --- NAVIGATION HELPERS ---

/**
 * Find the index of the next transition, rest, or rep-based exercise step after the current one.
 * @param {State} state
 */
const findNextBreakpointIndex = (state) => {
  for (let i = state.stepIndex + 1; i < state.workoutData.steps.length; i++) {
    const step = state.workoutData.steps[i];
    const t = step.type;
    if (t === "transition" || t === "rest") return i;
    if (t === "exercise" && step.volume.unit === "reps") return i;
  }
  return state.workoutData.steps.length;
};

/**
 * Find the index of the previous transition, rest, or rep-based exercise step before the current one.
 * @param {State} state
 */
const findPrevBreakpointIndex = (state) => {
  for (let i = state.stepIndex - 1; i >= 0; i--) {
    const step = state.workoutData.steps[i];
    const t = step.type;
    if (t === "transition" || t === "rest") return i;
    if (t === "exercise" && step.volume.unit === "reps") return i;
  }
  return 0;
};

// --- USER CONTROLS ---

/** @param {State} state */
const togglePause = (state) => {
  if (state.status === STATUS.DONE) {
    state.status = STATUS.EDITING;
    displayEditing();
    return;
  }

  if (state.status === STATUS.PAUSED) {
    isMuted = false;
    const pauseDuration = Date.now() - state.pauseStartTime;
    state.totalPausedMs += pauseDuration;
    state.pauseStartTime = 0;
    state.status = STATUS.IN_PROGRESS;
    // If we paused before step speech completed, trigger it now
    if (!state.stepAnnounced) {
      announceCurrentStep(state);
    } else {
      state.stepResumedAt = Date.now();
    }
    startTickTimer(state);
  } else if (state.status === STATUS.IN_PROGRESS) {
    cancelSpeech();
    if (state.stepResumedAt > 0) {
      const rawMs = state.stepElapsedMs + (Date.now() - state.stepResumedAt);
      state.stepElapsedMs = Math.floor(rawMs / 1000) * 1000;
      state.stepResumedAt = 0;
    }
    state.pauseStartTime = Date.now();
    state.status = STATUS.PAUSED;
    stopTickTimer(state);
  }

  updateDisplay(state);
};

/** @param {State} state */
const skipToNextExercise = (state) => {
  cancelSpeechForNewSpeech();
  const nextIndex = findNextBreakpointIndex(state);
  if (nextIndex >= state.workoutData.steps.length) {
    finishWorkout(state);
  } else {
    state.stepIndex = nextIndex;
    if (state.status === STATUS.IN_PROGRESS) {
      enterCurrentStep(state);
    } else {
      // Just update display without speech/timer when paused
      state.stepElapsedMs = 0;
      state.stepResumedAt = 0;
      state.stepAnnounced = false;
      state.stepEntryTime = Date.now();
      state.stepDuration = getStepDuration(
        state.workoutData.steps[state.stepIndex],
      );
      updateDisplay(state);
    }
  }
};

/** @param {State} state */
const skipToPrevExercise = (state) => {
  cancelSpeechForNewSpeech();
  const elapsedSinceEntry = Math.floor(
    (Date.now() - state.stepEntryTime) / 1000,
  );

  if (elapsedSinceEntry < STEP_JUST_STARTED_THRESHOLD_S) {
    state.stepIndex = findPrevBreakpointIndex(state);
  }

  if (state.status === STATUS.IN_PROGRESS) {
    enterCurrentStep(state);
  } else {
    // Just update display without speech/timer when paused
    state.stepElapsedMs = 0;
    state.stepResumedAt = 0;
    state.stepAnnounced = false;
    state.stepEntryTime = Date.now();
    state.stepDuration = getStepDuration(
      state.workoutData.steps[state.stepIndex],
    );
    updateDisplay(state);
  }
};

// --- INITIALIZATION ---

/** @type {State} */
let state = createInitialState();
/** @type {SpeechSynthesisVoice|undefined} */
let voice;
let wakeLock = null;
let audioUnlocked = false;
let isMuted = false;
/** @type {HTMLVideoElement|null} */
let noSleepVideo = null;

loadVoice();
if (window.speechSynthesis.onvoiceschanged !== undefined) {
  window.speechSynthesis.onvoiceschanged = loadVoice;
}

// Initialize NoSleep video for iOS
const initNoSleepVideo = () => {
  noSleepVideo = document.createElement("video");
  noSleepVideo.setAttribute("playsinline", "");
  noSleepVideo.setAttribute("muted", "");
  noSleepVideo.style.display = "none";
  // Minimal MP4 video (1x1 pixel, 1 frame)
  noSleepVideo.src =
    "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMQAAAAhmcmVlAAAAG21kYXQAAAGzABAHAAABthADAowdbb9/AAAC6W1vb3YAAABsbXZoZAAAAAB8JbCAfCWwgAAAA+gAAAAAAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAIVdHJhawAAAFx0a2hkAAAAD3wlsIB8JbCAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAABAAAAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAAAAAAAEAAAAAAAAAAAAAAQEAAAAAA0ltZGlhAAAAIG1kaGQAAAAAACWwgHwlsIBAAAAAAAAAAAAAAAAAgABAAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAAM2bWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAAIac3RibAAAAGpzdHNkAAAAAAAAAAEAAABabXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAAACAgAAAALJlc2RzAAAAAAOAgIAiAAIABICAgAEABAoSAAAAAAOAAAADIAAADwCAgIACBdBzcgADIFAGAgAAABhzdHRzAAAAAAAAAAEAAAABAAABAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAAAGAAAAAQAAABRzdGNvAAAAAAAAAAEAAAAsAAAAYnVkdGEAAAAYbWV0YQAAAAAAAAAAIFB1cmVkSW5wdXQAIEFwcmlsIEpvaG4gTmFydmV5b24AEWhlRnTBo=";
  noSleepVideo.loop = true;
  document.body.appendChild(noSleepVideo);
};

initNoSleepVideo();

// --- MULTI-WORKOUT MANAGEMENT ---

/** @type {{ workouts: string[], currentIndex: number }} */
let workoutStore = loadWorkoutStore();

function loadWorkoutStore() {
  const stored = localStorage.getItem(STORAGE_KEY_WORKOUTS);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed.workouts) && parsed.workouts.length > 0) {
        return {
          workouts: parsed.workouts,
          currentIndex: Math.min(
            Math.max(0, parsed.currentIndex ?? 0),
            parsed.workouts.length - 1,
          ),
        };
      }
    } catch (_) {}
  }
  return {
    workouts: [DEFAULT_WORKOUT],
    currentIndex: 0,
  };
}

function persistWorkoutStore() {
  localStorage.setItem(STORAGE_KEY_WORKOUTS, JSON.stringify(workoutStore));
}

function saveCurrentWorkoutText() {
  workoutStore.workouts[workoutStore.currentIndex] = DOM.inputText.value;
  persistWorkoutStore();
}

/**
 * @param {number} index
 */
function switchToWorkout(index) {
  saveCurrentWorkoutText();
  workoutStore.currentIndex = index;
  persistWorkoutStore();
  DOM.inputText.value = workoutStore.workouts[index];
  updateHighlightOverlay();
  updateEditorUI();
}

function createNewWorkout() {
  saveCurrentWorkoutText();
  workoutStore.workouts.push("");
  workoutStore.currentIndex = workoutStore.workouts.length - 1;
  persistWorkoutStore();
  DOM.inputText.value = "";
  updateHighlightOverlay();
  updateEditorUI();
  DOM.inputText.focus();
}

function deleteCurrentWorkout() {
  if (workoutStore.workouts.length <= 1) {
    workoutStore.workouts[0] = "";
    workoutStore.currentIndex = 0;
    persistWorkoutStore();
    DOM.inputText.value = "";
    updateHighlightOverlay();
    updateEditorUI();
    DOM.inputText.focus();
    return;
  }

  workoutStore.workouts.splice(workoutStore.currentIndex, 1);
  if (workoutStore.currentIndex > 0) {
    workoutStore.currentIndex--;
  }
  persistWorkoutStore();
  DOM.inputText.value = workoutStore.workouts[workoutStore.currentIndex];
  updateHighlightOverlay();
  updateEditorUI();
}

function updateEditorUI() {
  const total = workoutStore.workouts.length;
  const current = workoutStore.currentIndex + 1;
  DOM.editorSectionIndicator.innerText = `${current}/${total}`;
  DOM.editorPrevBtn.disabled = workoutStore.currentIndex === 0;
  DOM.editorNextBtn.disabled =
    workoutStore.currentIndex >= workoutStore.workouts.length - 1;
  DOM.deleteWorkoutBtn.innerText = total <= 1 ? "CLEAR" : "DELETE";
}

const initializeEditor = () => {
  DOM.inputText.value = workoutStore.workouts[workoutStore.currentIndex];
  updateHighlightOverlay();
  updateEditorUI();
};

initializeEditor();

// --- EVENT LISTENERS ---

DOM.startBtn.addEventListener("click", async () => {
  try {
    await startWorkout();
  } catch (e) {
    console.error("Error starting workout:", e);
    showError(e.message);
  }
});

DOM.stopBtn.addEventListener("click", () => {
  try {
    transitionToEditing(state);
  } catch (e) {
    console.error("Error stopping workout:", e);
    showError(e.message);
  }
});

DOM.playPauseBtn.addEventListener("click", () => {
  try {
    togglePause(state);
  } catch (e) {
    console.error("Error toggling pause:", e);
    showError(e.message);
  }
});

DOM.prevBtn.addEventListener("click", () => {
  try {
    skipToPrevExercise(state);
  } catch (e) {
    console.error("Error going to previous:", e);
    showError(e.message);
  }
});

DOM.nextBtn.addEventListener("click", () => {
  try {
    skipToNextExercise(state);
  } catch (e) {
    console.error("Error going to next:", e);
    showError(e.message);
  }
});

DOM.displayContainer.addEventListener("click", () => {
  try {
    if (DOM.displayContainer.dataset.tappable === "true") {
      console.log("Display tapped to skip transition/rest");
      const step = getCurrentStep(state);
      // For transitions, cancel speech before advancing
      if (step?.type === "transition") {
        cancelSpeechForNewSpeech();
      }
      advanceToNextStep(state);
    }
  } catch (e) {
    console.error("Error on tap:", e);
    showError(e.message);
  }
});

document.addEventListener("keydown", (e) => {
  try {
    if (state.status === STATUS.EDITING) {
      return;
    } else {
      if (
        e.code === "Enter" &&
        DOM.displayContainer.dataset.tappable === "true"
      ) {
        e.preventDefault();
        skipToNextExercise(state);
      } else if (e.code === "Escape") {
        e.preventDefault();
        transitionToEditing(state);
      } else if (e.code === "Space") {
        togglePause(state);
        e.preventDefault();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        skipToNextExercise(state);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        skipToPrevExercise(state);
      }
    }
  } catch (err) {
    console.error("Keyboard control error:", err);
    showError(err.message);
  }
});

DOM.muteBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  isMuted = !isMuted;
  if (isMuted) cancelSpeech();
  DOM.muteBtn.innerText = isMuted ? "Unmute" : "Mute";
  DOM.muteBtn.dataset.muted = isMuted.toString();
});

DOM.newWorkoutBtn.addEventListener("click", () => {
  createNewWorkout();
});

DOM.deleteWorkoutBtn.addEventListener("click", () => {
  deleteCurrentWorkout();
});

DOM.editorPrevBtn.addEventListener("click", () => {
  if (workoutStore.currentIndex > 0) {
    switchToWorkout(workoutStore.currentIndex - 1);
  }
});

DOM.editorNextBtn.addEventListener("click", () => {
  if (workoutStore.currentIndex < workoutStore.workouts.length - 1) {
    switchToWorkout(workoutStore.currentIndex + 1);
  }
});
