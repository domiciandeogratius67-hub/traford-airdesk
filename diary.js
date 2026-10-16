"use strict";

const DIARY_VAULT_KEY = "traford-diary.vault.v1";
const PBKDF2_ITERATIONS = 310_000;
const LOVE_NOTES = [
  "I hope you remember how gently you make the world feel.",
  "You are allowed to bloom at your own pace.",
  "Even your ordinary days are worth keeping.",
  "There is so much quiet courage in the way you keep going.",
  "I hope something small makes you smile today.",
  "You make being yourself look like a beautiful thing.",
  "Rest is a lovely way of taking care of tomorrow.",
  "The world is better with your particular kind of light in it.",
  "One small step is still a step worth celebrating.",
  "I hope you speak to yourself as kindly as you speak to others.",
  "You don't have to have it all figured out to be doing just fine.",
  "Your dreams deserve the room you give everyone else's.",
  "Somewhere, someone is grateful that you are exactly you.",
  "It's okay to begin again, as many times as you need.",
  "May today surprise you with one lovely little thing.",
  "You make softness feel strong.",
  "Keep the moments that make your heart feel at home.",
  "Your laugh belongs in the best parts of every story.",
  "You are more than enough on the days you feel like less.",
  "There is no rush. Your life is not a race.",
  "I hope you notice how far the girl you were has brought you.",
  "You make thoughtful things feel effortless.",
  "Let today be gentle with you, and be gentle with yourself too.",
  "You are still becoming, and that is something to be proud of.",
  "The way you care is one of your loveliest things.",
  "May you find a little wonder in an ordinary corner today.",
  "You can put something down and pick it back up when you're ready.",
  "I believe in your ideas, even the ones still finding their shape.",
  "Your heart has carried you through every hard day so far.",
  "You bring a little more beauty into every room you enter.",
  "Take a breath. You have made it to this moment.",
  "You deserve the kind of love you give so freely.",
  "Today is not asking you to be perfect, only to be here.",
  "You have a gift for making people feel remembered.",
  "It is brave to keep a tender heart in a busy world.",
  "Your pace is a good pace.",
  "I hope you make something just because it makes you happy.",
  "You have made a home in more hearts than you know.",
  "There is a lovely kind of magic in the way you notice things.",
  "May you feel proud of a small thing today.",
  "You are allowed to change your mind and choose a new path.",
  "The future gets a little brighter when you imagine it.",
  "You don't need to earn a quiet afternoon.",
  "Some of the best things about you are the ones you don't notice.",
  "Your kindness is never a small thing.",
  "Make room for the version of you who is still learning.",
  "I hope you find something beautiful without even looking.",
  "You make the people around you feel a little more like themselves.",
  "Keep going, sweetheart. Slowly is still forward.",
  "You deserve to be celebrated on the days with no big achievement.",
  "I hope your next chapter surprises you in the best ways.",
  "There is nothing ordinary about the way you are you.",
  "You can start over after lunch, or tomorrow, or whenever.",
  "I hope you let yourself be proud of how much you care.",
  "You make love feel like a safe place to land.",
  "The small joys count. Especially the small joys.",
  "You are someone's favourite thought on an ordinary day.",
  "Keep a little space for the things that make you feel alive.",
  "May you always remember that you are easy to love.",
  "I am cheering for every small brave thing you do.",
  "This little book is yours. Fill it with all of you."
];
const VIEW_LABELS = {
  diary: "My diary",
  ideas: "My ideas",
  calendar: "Calendar",
  reminders: "Reminders"
};

let activeView = "diary";
let entryCursor = 0;
let editingEntryId = null;
let selectedDate = localDateString(new Date());
let calendarDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let pendingPhoto = null;
let entryAttachments = []; // photo ids attached to the entry being edited
let diarySalt = null;
let workspaceInitialized = false;
let vaultSaveTimer = 0;
let vaultWriteQueue = Promise.resolve();
let reminderTimer = 0;

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  const [year, month, day] = String(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function base64FromBytes(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesFromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveDiaryKey(password, salt) {
  const material = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptVault() {
  if (!vaultKey || !vaultData) return;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainText = new TextEncoder().encode(JSON.stringify(vaultData));
  const cipherText = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vaultKey, plainText);
  const record = {
    version: 1,
    iterations: PBKDF2_ITERATIONS,
    salt: base64FromBytes(diarySalt),
    iv: base64FromBytes(iv),
    ciphertext: base64FromBytes(new Uint8Array(cipherText))
  };
  try {
    localStorage.setItem(DIARY_VAULT_KEY, JSON.stringify(record));
  } catch {
    throw new Error("This browser ran out of storage. Export or remove some large items before saving.");
  }
}

function scheduleVaultSave() {
  window.clearTimeout(vaultSaveTimer);
  vaultSaveTimer = window.setTimeout(() => {
    vaultWriteQueue = vaultWriteQueue
      .then(encryptVault)
      .catch((error) => showToast(error.message || "Your diary could not be saved."));
  }, 120);
}

async function flushVaultSave() {
  window.clearTimeout(vaultSaveTimer);
  vaultWriteQueue = vaultWriteQueue
    .then(encryptVault)
    .catch((error) => {
      showToast(error.message || "Your diary could not be saved.");
      throw error;
    });
  return vaultWriteQueue;
}

const MAX_PHOTOS = 200;
const MAX_PHOTO_BYTES = 1_200_000; // ~1.2MB target after resize

function emptyVault(name) {
  return {
    version: 1,
    profile: { name, photo: null },
    entries: [],
    reminders: [],
    firedReminders: [],
    cards: [],
    messages: [],
    photos: []
  };
}

function validateVault(data) {
  if (!data || data.version !== 1 || !data.profile || typeof data.profile.name !== "string") {
    throw new Error("This diary file is not in a format this version can open.");
  }
  for (const key of ["entries", "reminders", "firedReminders", "cards", "messages"]) {
    if (!Array.isArray(data[key])) data[key] = [];
  }
  if (data.profile.photo !== null && typeof data.profile.photo !== "string") {
    throw new Error("The saved profile picture is not valid.");
  }
  return data;
}

function loadLegacyItems(key) {
  try {
    const value = localStorage.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function createDiary(name, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  diarySalt = salt;
  const key = await deriveDiaryKey(password, salt);
  vaultData = emptyVault(name);
  vaultData.cards = loadLegacyItems(STORAGE_KEYS.cards);
  vaultData.messages = loadLegacyItems(STORAGE_KEYS.messages);
  vaultKey = key;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(vaultData))
    );
    localStorage.setItem(DIARY_VAULT_KEY, JSON.stringify({
      version: 1,
      iterations: PBKDF2_ITERATIONS,
      salt: base64FromBytes(salt),
      iv: base64FromBytes(iv),
      ciphertext: base64FromBytes(new Uint8Array(ciphertext))
    }));
    localStorage.removeItem(STORAGE_KEYS.cards);
    localStorage.removeItem(STORAGE_KEYS.messages);
  } catch (error) {
    vaultData = null;
    vaultKey = null;
    diarySalt = null;
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      throw new Error("This browser does not have enough storage for your diary yet.");
    }
    throw error;
  }
}

async function unlockDiary(password) {
  const record = JSON.parse(localStorage.getItem(DIARY_VAULT_KEY) || "null");
  if (!record || record.version !== 1 || record.iterations !== PBKDF2_ITERATIONS) {
    throw new Error("This diary is damaged or uses an unsupported version.");
  }
  try {
    const salt = bytesFromBase64(record.salt);
    const iv = bytesFromBase64(record.iv);
    if (salt.length !== 16 || iv.length !== 12) throw new Error("Invalid diary key.");
    const key = await deriveDiaryKey(password, salt);
    const clearText = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv }, key, bytesFromBase64(record.ciphertext)
    );
    const parsed = JSON.parse(new TextDecoder().decode(clearText));
    vaultData = validateVault(parsed);
    vaultKey = key;
    diarySalt = salt;
    localStorage.removeItem(STORAGE_KEYS.cards);
    localStorage.removeItem(STORAGE_KEYS.messages);
  } catch (error) {
    vaultData = null;
    vaultKey = null;
    diarySalt = null;
    if (error instanceof DOMException && error.name === "OperationError") {
      throw new Error("That password did not open this diary. Try again.");
    }
    if (error instanceof SyntaxError) throw new Error("The diary data could not be read.");
    throw error;
  }
}

function showGate(isLogin) {
  const nameLabel = document.querySelector("#gate-name").previousElementSibling;
  const password = document.querySelector("#gate-password");
  const confirm = document.querySelector("#gate-confirm");
  const name = document.querySelector("#gate-name");
  document.querySelector("#gate-title").innerHTML = isLogin
    ? "Your book is <span>waiting.</span>"
    : "A diary for <span>you.</span>";
  document.querySelector("#gate-intro").textContent = isLogin
    ? "Your pages are tucked away safely. Type the password you chose to open them."
    : "A quiet little place for your memories, ideas, and every version of you.";
  document.querySelector("#gate-submit").textContent = isLogin ? "Open my little book ♡" : "Make my little book ♡";
  document.querySelector("#gate-hint").textContent = isLogin
    ? "Your diary is encrypted on this device. It opens only with the password you chose."
    : "Your diary is encrypted in this browser. Traford cannot see it. If you forget your password, this browser cannot recover your pages—please keep it somewhere safe.";
  name.hidden = isLogin;
  name.required = !isLogin;
  nameLabel.hidden = isLogin;
  confirm.hidden = isLogin;
  confirm.required = !isLogin;
  document.querySelector("#confirm-label").hidden = isLogin;
  document.querySelector("#gate-signoff").textContent = isLogin
    ? "A little note, with love from Traford."
    : "This diary is dedicated to you, with love from Traford.";
  document.querySelector("#gate-error").textContent = "";
  password.value = "";
  confirm.value = "";
  document.querySelector("#welcome-gate").hidden = false;
  document.body.classList.add("diary-locked");
  window.setTimeout(() => (isLogin ? password : name).focus(), 50);
}

function enterDiary() {
  cards = vaultData.cards;
  messages = vaultData.messages;
  document.querySelector("#welcome-gate").hidden = true;
  document.body.classList.remove("diary-locked");
  elements.modelLabel.textContent = settings.model;
  document.body.classList.toggle("high-contrast", Boolean(settings.highContrast));
  if (!workspaceInitialized) {
    init();
    workspaceInitialized = true;
  }
  renderCards();
  renderMessages();
  renderDiary();
  renderCalendar();
  renderReminders();
  updateProfileUI();
  checkConnection();
  if (!reminderTimer) reminderTimer = window.setInterval(checkDueReminders, 15_000);
  checkDueReminders();
}

function escapeDiaryText(value) {
  return escapeHTML(value);
}

function todayLoveNote() {
  const day = Math.floor((new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) - new Date(new Date().getFullYear(), 0, 0)) / 86_400_000);
  return LOVE_NOTES[(day - 1) % LOVE_NOTES.length];
}

function sortedEntries() {
  return [...vaultData.entries].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
}

function renderDiary() {
  if (!vaultData) return;
  const entries = sortedEntries();
  const today = localDateString(new Date());
  entryCursor = Math.max(0, Math.min(entryCursor, Math.max(entries.length - 1, 0)));
  const current = entries[entryCursor] || null;
  elements.ideaCount.textContent = entries.length
    ? `${entries.length} ${entries.length === 1 ? "page" : "pages"}`
    : "Your story";
  document.querySelector("#nav-entry-count").textContent = String(entries.length);
  const firstName = vaultData.profile.name.trim().split(/\s+/)[0];
  document.querySelector("#desk-title").innerHTML = `A book full of <span>${escapeDiaryText(firstName)}.</span>`;
  document.querySelector("#dedication-subtitle").textContent = `A little diary dedicated to you, ${firstName}, with love from Traford.`;
  const page = current
    ? `<div class="book-page-date">${formatDiaryDate(current.date)} <span>${escapeDiaryText(current.mood || "A little moment")}</span></div>
       <h2 class="book-entry-title">${escapeDiaryText(current.title || "A day in my life")}</h2>
       <div class="book-entry-body">${escapeDiaryText(current.body || "").replace(/\n/g, "<br>")}</div>
       <div class="book-entry-actions"><button class="quiet-button" type="button" data-entry-action="edit" data-id="${escapeDiaryText(current.id)}">Edit this page</button><button class="quiet-button" type="button" data-entry-action="delete" data-id="${escapeDiaryText(current.id)}">Remove page</button></div>`
    : `<div class="book-empty"><span>♡</span><h2>Your first page is waiting.</h2><p>Write about today, a little dream, or anything you'd like to remember.</p><button class="primary-button" type="button" id="book-first-entry">Write your first page</button></div>`;
  document.querySelector("#diary-book").innerHTML = `
    <div class="book-spread">
      <article class="book-page book-left-page">
        <div class="page-flower">✿</div>
        <div class="book-dedication">A little note for today</div>
        <p class="book-love-note">“${escapeDiaryText(todayLoveNote())}”</p>
        <div class="love-signoff">With love,<br><strong>Traford</strong> <span>♡</span></div>
        <div class="page-number">♡</div>
      </article>
      <article class="book-page book-right-page">${page}<div class="page-number">${current ? entries.length - entryCursor : "♡"}</div></article>
    </div>
    <div class="book-controls">
      <button class="quiet-button" id="book-older" type="button" ${entryCursor >= entries.length - 1 ? "disabled" : ""}>← Older page</button>
      <span>${current ? `${entryCursor + 1} of ${entries.length}` : "A new beginning"}</span>
      <button class="quiet-button" id="book-newer" type="button" ${entryCursor <= 0 ? "disabled" : ""}>Newer page →</button>
    </div>`;
  document.querySelector("#book-older")?.addEventListener("click", () => { entryCursor += 1; renderDiary(); });
  document.querySelector("#book-newer")?.addEventListener("click", () => { entryCursor -= 1; renderDiary(); });
  document.querySelector("#book-first-entry")?.addEventListener("click", () => openEntryDialog());
}

function formatDiaryDate(value) {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(parseLocalDate(value));
}

function openEntryDialog(entry = null, date = localDateString(new Date())) {
  editingEntryId = entry?.id || null;
  elements.noteHeading.value = entry?.title || "";
  elements.noteBody.value = entry?.body || "";
  document.querySelector("#note-date-input").value = entry?.date || date;
  document.querySelector("#note-mood-input").value = entry?.mood || "💗 Soft & happy";
  document.querySelector("#note-title").textContent = entry ? "Turn the page" : "Write a diary page";
  // prepare attachments preview and selection
  entryAttachments = entry?.attachments ? [...entry.attachments] : [];
  renderNotePhotoPreview();
  elements.noteDialog.showModal();
  window.setTimeout(() => elements.noteHeading.focus(), 50);
}

function saveEntry() {
  const title = elements.noteHeading.value.trim();
  const body = elements.noteBody.value.trim();
  const date = document.querySelector("#note-date-input").value;
  if (!title && !body) {
    showToast("Write a little something before saving your page.");
    return;
  }
  if (!date) {
    showToast("Choose a date for your page.");
    return;
  }
  const existing = vaultData.entries.find((item) => item.id === editingEntryId);
  const entry = {
    id: editingEntryId || makeId(),
    title: title || "A day in my life",
    body,
    date,
    mood: document.querySelector("#note-mood-input").value,
    attachments: [...entryAttachments],
    updatedAt: Date.now()
  };
  if (existing) Object.assign(existing, entry);
  else vaultData.entries.push(entry);
  scheduleVaultSave();
  entryCursor = 0;
  selectedDate = date;
  renderDiary();
  renderCalendar();
  elements.noteDialog.close();
  showToast("Your page is safely tucked into your book. ♡");
}

async function processImageFile(file) {
  if (!file.type.startsWith("image/")) throw new Error("Only images are allowed.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose an image smaller than 10 MB.");
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1024;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  // try to produce a blob under MAX_PHOTO_BYTES by reducing quality if needed
  let quality = 0.78;
  for (let i = 0; i < 5; i++) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("Could not prepare image.");
    if (blob.size <= MAX_PHOTO_BYTES || quality <= 0.4) {
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ dataUrl: reader.result, size: blob.size });
        reader.onerror = () => reject(new Error("Could not read image."));
        reader.readAsDataURL(blob);
      });
    }
    quality -= 0.12;
  }
  // fallback: return last available blob
  const fallbackBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.4));
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataUrl: reader.result, size: fallbackBlob.size });
    reader.onerror = () => reject(new Error("Could not read image."));
    reader.readAsDataURL(fallbackBlob);
  });
}

async function handleNotePhotos(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  if (!files.length) return;
  if (!vaultData) { showToast("Open your diary first."); return; }
  for (const file of files) {
    if (vaultData.photos.length >= MAX_PHOTOS) {
      showToast(`Your diary already has ${MAX_PHOTOS} photos. Remove a few to add more.`);
      break;
    }
    try {
      const { dataUrl } = await processImageFile(file);
      const id = makeId();
      vaultData.photos.push({ id, dataUrl, createdAt: Date.now() });
      entryAttachments.push(id);
      scheduleVaultSave();
    } catch (error) {
      showToast(error.message || "One photo could not be processed.");
    }
  }
  renderNotePhotoPreview();
}

function renderNotePhotoPreview() {
  const host = document.querySelector("#note-photo-preview");
  host.replaceChildren();
  const count = entryAttachments.length;
  if (!count) {
    host.textContent = "No photos attached.";
    return;
  }
  for (const id of entryAttachments) {
    const photo = vaultData.photos.find((p) => p.id === id);
    if (!photo) continue;
    const wrap = document.createElement("div");
    wrap.className = "photo-thumb";
    const img = document.createElement("img");
    img.src = photo.dataUrl;
    img.alt = "Attached photo";
    const remove = document.createElement("button");
    remove.className = "remove-thumb";
    remove.title = "Remove this photo";
    remove.type = "button";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      // permanently remove photo
      vaultData.photos = vaultData.photos.filter((p) => p.id !== id);
      // remove references in any entries
      for (const e of vaultData.entries) {
        if (Array.isArray(e.attachments)) e.attachments = e.attachments.filter((aid) => aid !== id);
      }
      entryAttachments = entryAttachments.filter((aid) => aid !== id);
      scheduleVaultSave();
      renderNotePhotoPreview();
    });
    wrap.appendChild(img);
    wrap.appendChild(remove);
    host.appendChild(wrap);
  }
  const info = document.createElement("div");
  info.className = "photo-count";
  info.textContent = `${count} attached photo${count === 1 ? "" : "s"} — stored in your diary`;
  host.appendChild(info);
}

function saveIdeaCard(title, description) {
  const cleanTitle = String(title || "").trim().slice(0, 90);
  const cleanDescription = String(description || "").trim().slice(0, 4000);
  if (!cleanTitle && !cleanDescription) {
    showToast("Add a few words before saving this idea.");
    return false;
  }
  cards.unshift({
    id: makeId(),
    title: cleanTitle || "A thought to come back to",
    description: cleanDescription,
    category: "JUST FOR YOU",
    tags: ["Little idea"],
    tone: "pink",
    pinned: false,
    createdAt: Date.now()
  });
  store(STORAGE_KEYS.cards, cards);
  renderCards();
  return true;
}

function openIdeaDialog() {
  document.querySelector("#idea-title-input").value = "";
  document.querySelector("#idea-body-input").value = "";
  document.querySelector("#idea-dialog").showModal();
  window.setTimeout(() => document.querySelector("#idea-title-input").focus(), 50);
}

function renderCalendar() {
  if (!vaultData) return;
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  document.querySelector("#calendar-month").textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(calendarDate);
  const first = new Date(year, month, 1);
  const leading = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const today = localDateString(new Date());
  const host = document.querySelector("#calendar-days");
  host.replaceChildren();
  for (let cell = 0; cell < leading; cell += 1) {
    const blank = document.createElement("span");
    blank.className = "calendar-blank";
    blank.setAttribute("aria-hidden", "true");
    host.append(blank);
  }
  for (let day = 1; day <= days; day += 1) {
    const date = localDateString(new Date(year, month, day));
    const hasEntry = vaultData.entries.some((entry) => entry.date === date);
    const hasReminder = vaultData.reminders.some((reminder) => reminder.date === date);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `calendar-day${date === today ? " is-today" : ""}${date === selectedDate ? " is-selected" : ""}${hasEntry || hasReminder ? " has-event" : ""}`;
    button.setAttribute("aria-label", `${formatDiaryDate(date)}${hasEntry ? ", diary page" : ""}${hasReminder ? ", reminder" : ""}`);
    button.innerHTML = `<span>${day}</span>${hasEntry || hasReminder ? `<i aria-hidden="true">${hasEntry ? "♡" : "•"}</i>` : ""}`;
    button.addEventListener("click", () => { selectedDate = date; renderCalendar(); });
    host.append(button);
  }
  renderSelectedDate();
}

function renderSelectedDate() {
  const host = document.querySelector("#calendar-selected");
  const entries = vaultData.entries.filter((entry) => entry.date === selectedDate);
  const reminders = vaultData.reminders.filter((item) => item.date === selectedDate);
  host.innerHTML = `<div class="selected-day-heading"><div><span class="eyebrow">A LITTLE LOOK BACK</span><h2>${escapeDiaryText(formatDiaryDate(selectedDate))}</h2></div><button class="quiet-button" id="selected-day-write" type="button">＋ Write a page</button></div>
    ${entries.length ? entries.map((entry) => `<button class="calendar-event" type="button" data-calendar-entry="${escapeDiaryText(entry.id)}"><span>♡</span><span><strong>${escapeDiaryText(entry.title)}</strong><small>${escapeDiaryText(entry.mood || "")}</small></span></button>`).join("") : `<p class="empty-day">No pages for this day yet. There's still time to make a little memory.</p>`}
    ${reminders.map((item) => `<div class="calendar-event reminder-event"><span>◷</span><span><strong>${escapeDiaryText(item.title)}</strong><small>${escapeDiaryText(item.time || "A gentle reminder")}</small></span></div>`).join("")}`;
  document.querySelector("#selected-day-write").addEventListener("click", () => openEntryDialog(null, selectedDate));
  host.querySelectorAll("[data-calendar-entry]").forEach((button) => button.addEventListener("click", () => {
    entryCursor = sortedEntries().findIndex((entry) => entry.id === button.dataset.calendarEntry);
    showView("diary");
  }));
}

function renderReminders() {
  if (!vaultData) return;
  document.querySelector("#reminder-count").textContent = String(vaultData.reminders.length);
  const host = document.querySelector("#reminder-list");
  const sorted = [...vaultData.reminders].sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
  if (!sorted.length) {
    host.innerHTML = `<div class="empty-reminders glass-card"><span>♡</span><h2>Nothing to remember just yet.</h2><p>Leave yourself a gentle note for later. Future-you will be glad.</p></div>`;
    return;
  }
  host.innerHTML = sorted.map((reminder) => `<article class="reminder-item glass-card"><span class="reminder-heart">♡</span><div class="reminder-copy"><strong>${escapeDiaryText(reminder.title)}</strong><span>${escapeDiaryText(formatDiaryDate(reminder.date))}${reminder.time ? ` · ${escapeDiaryText(reminder.time)}` : ""}</span></div><button class="card-action" type="button" data-remove-reminder="${escapeDiaryText(reminder.id)}" aria-label="Remove reminder">×</button></article>`).join("");
  host.querySelectorAll("[data-remove-reminder]").forEach((button) => button.addEventListener("click", () => {
    vaultData.reminders = vaultData.reminders.filter((item) => item.id !== button.dataset.removeReminder);
    scheduleVaultSave();
    renderReminders();
    renderCalendar();
    showToast("Reminder removed.");
  }));
}

function openReminderDialog(date = localDateString(new Date())) {
  document.querySelector("#reminder-title-input").value = "";
  document.querySelector("#reminder-date-input").value = date;
  document.querySelector("#reminder-time-input").value = "";
  document.querySelector("#reminder-dialog").showModal();
  window.setTimeout(() => document.querySelector("#reminder-title-input").focus(), 50);
}

function saveReminder() {
  const title = document.querySelector("#reminder-title-input").value.trim();
  const date = document.querySelector("#reminder-date-input").value;
  const time = document.querySelector("#reminder-time-input").value;
  if (!title || !date) {
    showToast("Add a reminder and choose a day.");
    return;
  }
  vaultData.reminders.push({ id: makeId(), title: title.slice(0, 100), date, time });
  scheduleVaultSave();
  renderReminders();
  renderCalendar();
  document.querySelector("#reminder-dialog").close();
  showToast("A little reminder is saved.");
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    showToast("This browser does not support notifications. In-diary reminders still work while this page is open.");
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission === "granted") {
    showToast("Notifications are on. I'll give you a gentle nudge while your diary is open.");
    checkDueReminders();
  } else {
    showToast("Notifications stayed off. Your reminders are still saved in your diary.");
  }
}

function checkDueReminders() {
  if (!vaultData || !vaultData.reminders.length) return;
  const now = new Date();
  const today = localDateString(now);
  const minute = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  let changed = false;
  for (const reminder of vaultData.reminders) {
    const dueTime = reminder.time || "09:00";
    const fireKey = `${reminder.id}:${today}`;
    if (reminder.date !== today || dueTime > minute || vaultData.firedReminders.includes(fireKey)) continue;
    vaultData.firedReminders.push(fireKey);
    changed = true;
    showToast(`A little reminder: ${reminder.title}`);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("A little note for you ♡", { body: reminder.title, tag: reminder.id });
    }
  }
  if (changed) scheduleVaultSave();
}

function setAvatar(element, photo, fallback) {
  element.replaceChildren();
  if (!photo) {
    element.textContent = fallback;
    element.classList.remove("has-photo");
    return;
  }
  const image = document.createElement("img");
  image.src = photo;
  image.alt = "";
  element.append(image);
  element.classList.add("has-photo");
}

function updateProfileUI() {
  const profile = vaultData.profile;
  const firstName = profile.name.trim().split(/\s+/)[0];
  document.querySelector("#sidebar-name").textContent = `${firstName}'s diary`;
  document.querySelector("#sidebar-profile-name").textContent = profile.name;
  document.querySelector("#breadcrumb-home").textContent = `${firstName}'s diary`;
  document.querySelector("#profile-name-input").value = profile.name;
  document.querySelector("#profile-dedication").textContent = `This diary is dedicated to you, ${profile.name}, with love from Traford.`;
  setAvatar(document.querySelector("#sidebar-avatar"), profile.photo, "♡");
  setAvatar(document.querySelector("#topbar-avatar"), profile.photo, firstName[0]?.toUpperCase() || "♡");
  const preview = document.querySelector("#profile-photo-preview");
  setAvatar(preview, pendingPhoto || profile.photo, "♡");
}

function showView(view) {
  activeView = view;
  document.querySelector(".desk-content").classList.toggle("hidden-view", view !== "diary");
  document.querySelector("#ideas-view").classList.toggle("hidden-view", view !== "ideas");
  document.querySelector("#calendar-view").classList.toggle("hidden-view", view !== "calendar");
  document.querySelector("#reminders-view").classList.toggle("hidden-view", view !== "reminders");
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelector("#breadcrumb-view").textContent = VIEW_LABELS[view];
  document.body.classList.remove("presenting");
  document.querySelector("#present-button span").textContent = "Read together";
}

async function handleProfilePhoto(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
    showToast("Choose an image smaller than 10 MB.");
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    pendingPhoto = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error("That picture could not be prepared."));
        else {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("That picture could not be read."));
          reader.readAsDataURL(blob);
        }
      }, "image/jpeg", 0.78);
    });
    updateProfileUI();
  } catch (error) {
    showToast(error.message || "That picture could not be opened.");
  }
}

function saveProfile() {
  const name = document.querySelector("#profile-name-input").value.trim();
  if (!name) {
    showToast("Add the name you'd like your diary to use.");
    return;
  }
  vaultData.profile.name = name.slice(0, 50);
  if (pendingPhoto) vaultData.profile.photo = pendingPhoto;
  pendingPhoto = null;
  scheduleVaultSave();
  updateProfileUI();
  renderDiary();
  document.querySelector("#profile-dialog").close();
  showToast("Your profile has been tucked into your diary. ♡");
}

async function lockDiary() {
  try {
    await flushVaultSave();
  } catch {
    return;
  }
  vaultKey = null;
  vaultData = null;
  diarySalt = null;
  cards = [];
  messages = [];
  showGate(true);
}

function bindDiaryControls() {
  document.querySelector("#settings-button").addEventListener("click", () => {
    pendingPhoto = null;
    updateProfileUI();
    document.querySelector("#profile-dialog").showModal();
  });
  document.querySelector("#lock-button").addEventListener("click", lockDiary);
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  document.querySelector("#new-note-button").addEventListener("click", () => openEntryDialog());
  document.querySelector("#save-note-button").addEventListener("click", saveEntry);
  document.querySelector("#add-idea-button").addEventListener("click", openEntryDialog);
  document.querySelector("#calendar-add-entry").addEventListener("click", () => openEntryDialog(null, selectedDate));
  document.querySelector("#idea-view-add").addEventListener("click", openIdeaDialog);
  document.querySelector("#save-idea-button").addEventListener("click", () => {
    if (saveIdeaCard(document.querySelector("#idea-title-input").value, document.querySelector("#idea-body-input").value)) {
      document.querySelector("#idea-dialog").close();
      showToast("Your little idea is saved. ♡");
    }
  });
  document.querySelector("#cancel-idea-button").addEventListener("click", () => document.querySelector("#idea-dialog").close());
  document.querySelector("#diary-book").addEventListener("click", (event) => {
    const button = event.target.closest("[data-entry-action]");
    if (!button) return;
    const entry = vaultData.entries.find((item) => item.id === button.dataset.id);
    if (!entry) return;
    if (button.dataset.entryAction === "edit") openEntryDialog(entry);
    else {
      vaultData.entries = vaultData.entries.filter((item) => item.id !== entry.id);
      entryCursor = 0;
      scheduleVaultSave();
      renderDiary();
      renderCalendar();
      showToast("That page was removed from your book.");
    }
  });
  document.querySelector("#calendar-prev").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderCalendar();
  });
  document.querySelector("#calendar-next").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderCalendar();
  });
  document.querySelector("#calendar-today").addEventListener("click", () => {
    calendarDate = new Date();
    selectedDate = localDateString(new Date());
    renderCalendar();
  });
  document.querySelector("#add-reminder-button").addEventListener("click", () => openReminderDialog());
  document.querySelector("#save-reminder-button").addEventListener("click", saveReminder);
  document.querySelector("#cancel-reminder-button").addEventListener("click", () => document.querySelector("#reminder-dialog").close());
  document.querySelector("#enable-notifications").addEventListener("click", enableNotifications);
  document.querySelector("#profile-photo-input").addEventListener("change", handleProfilePhoto);
  document.querySelector("#note-photo-input").addEventListener("change", handleNotePhotos);
  document.querySelector("#save-profile-button").addEventListener("click", saveProfile);
  document.querySelector("#note-dialog").addEventListener("close", () => { editingEntryId = null; });
  document.querySelector("#present-button").addEventListener("click", (event) => {
    const active = document.body.classList.toggle("presenting");
    event.currentTarget.querySelector("span").textContent = active ? "Close book" : "Read together";
    event.currentTarget.setAttribute("aria-pressed", String(active));
  });
}

async function onGateSubmit(event) {
  event.preventDefault();
  const isLogin = Boolean(localStorage.getItem(DIARY_VAULT_KEY));
  const name = document.querySelector("#gate-name").value.trim();
  const password = document.querySelector("#gate-password").value;
  const confirm = document.querySelector("#gate-confirm").value;
  const error = document.querySelector("#gate-error");
  const button = document.querySelector("#gate-submit");
  error.textContent = "";
  if (password.length < 8) {
    error.textContent = "Please choose at least 8 characters for your diary password.";
    return;
  }
  if (!isLogin && password !== confirm) {
    error.textContent = "Those passwords don't quite match yet.";
    return;
  }
  button.disabled = true;
  button.textContent = "Opening your little book…";
  try {
    if (isLogin) await unlockDiary(password);
    else await createDiary(name.slice(0, 50), password);
    enterDiary();
  } catch (exception) {
    error.textContent = exception.message || "Your diary could not be opened.";
    button.textContent = isLogin ? "Open my little book ♡" : "Make my little book ♡";
  } finally {
    button.disabled = false;
  }
}

function startDiaryApp() {
  document.querySelector("#gate-form").addEventListener("submit", onGateSubmit);
  document.querySelector("#profile-dialog").addEventListener("close", () => { pendingPhoto = null; });
  bindDiaryControls();
  try {
    if (!crypto?.subtle) throw new Error("Use a modern browser over HTTPS to open your encrypted diary.");
  } catch (error) {
    document.querySelector("#gate-error").textContent = error.message;
  }
  showGate(Boolean(localStorage.getItem(DIARY_VAULT_KEY)));
}

startDiaryApp();
