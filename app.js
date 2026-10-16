"use strict";

const STORAGE_KEYS = {
  cards: "traford-airdesk.cards.v1",
  messages: "traford-airdesk.messages.v1",
  settings: "traford-airdesk.settings.v1"
};
let vaultKey = null;
let vaultData = null;
const DEFAULT_SETTINGS = { endpoint: "http://127.0.0.1:8765", model: "qwen3", highContrast: false };
const STARTER_CARDS = [
  {
    id: "starter-north-star",
    title: "A space for your next big thing",
    description: "This is your desk: a place to collect the ideas you don't want to lose, and make a little room for what comes next.",
    category: "A NOTE TO SELF",
    tags: ["Start anywhere", "Make it yours"],
    tone: "featured",
    pinned: true,
    createdAt: 1
  },
  {
    id: "starter-side-project",
    title: "That side project idea",
    description: "A little corner of the internet for sharing small, thoughtful projects. What would make someone feel welcome?",
    category: "IN PROGRESS",
    tags: ["Just an idea", "Explore"],
    tone: "pink",
    pinned: false,
    createdAt: 2
  },
  {
    id: "starter-weekend",
    title: "Make more room for wonder",
    description: "A simple weekend ritual: go somewhere new, leave the headphones at home, and notice one thing worth remembering.",
    category: "LIFE & LITTLE THINGS",
    tags: ["Weekend note"],
    tone: "lilac",
    pinned: false,
    createdAt: 3
  }
];
const HELLO_MESSAGE = {
  role: "assistant",
  content: "Hi! I’m here whenever you’re ready. What’s on your mind?",
  time: Date.now()
};

let cards = [];
let messages = [];
let settings = { ...DEFAULT_SETTINGS, ...loadStored(STORAGE_KEYS.settings, {}) };
let busy = false;
let toastTimer = 0;

const elements = {
  cardGrid: document.querySelector("#idea-grid"),
  ideaCount: document.querySelector("#idea-count"),
  navCardCount: document.querySelector("#nav-card-count"),
  greetingDate: document.querySelector("#greeting-date"),
  chatWelcome: document.querySelector("#chat-welcome"),
  chatMessages: document.querySelector("#chat-messages"),
  chatInput: document.querySelector("#chat-input"),
  chatThinking: document.querySelector("#chat-thinking"),
  sendButton: document.querySelector("#send-button"),
  connectionPill: document.querySelector("#connection-pill"),
  connectionLabel: document.querySelector("#connection-label"),
  chatStatusDot: document.querySelector("#chat-status-dot"),
  chatStatusLabel: document.querySelector("#chat-status-label"),
  settingsDialog: document.querySelector("#settings-dialog"),
  settingsStatus: document.querySelector("#settings-status"),
  endpointInput: document.querySelector("#endpoint-input"),
  modelInput: document.querySelector("#model-input"),
  modelLabel: document.querySelector("#model-label"),
  noteDialog: document.querySelector("#note-dialog"),
  noteHeading: document.querySelector("#note-heading-input"),
  noteBody: document.querySelector("#note-body-input"),
  toast: document.querySelector("#toast")
};

function loadStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function store(key, value) {
  if ((key === STORAGE_KEYS.cards || key === STORAGE_KEYS.messages) && vaultKey && vaultData) {
    vaultData[key === STORAGE_KEYS.cards ? "cards" : "messages"] = value;
    scheduleVaultSave();
    return;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    showToast("Your browser could not save that change. Check local storage settings.");
  }
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function inlineMarkdown(value) {
  return escapeHTML(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function safeMarkdown(value) {
  const lines = String(value).split(/\r?\n/);
  const output = [];
  let paragraph = [];
  let inList = false;
  const endParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${paragraph.map(inlineMarkdown).join("<br>")}</p>`);
      paragraph = [];
    }
  };
  const endList = () => {
    if (inList) {
      output.push("</ul>");
      inList = false;
    }
  };
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      endParagraph();
      if (!inList) {
        output.push("<ul>");
        inList = true;
      }
      output.push(`<li>${inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
    } else if (line.trim() === "") {
      endParagraph();
      endList();
    } else {
      endList();
      paragraph.push(line);
    }
  }
  endParagraph();
  endList();
  return output.join("");
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `idea-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setDate() {
  const now = new Date();
  elements.greetingDate.textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long", month: "long", day: "numeric"
  }).format(now);
}

function renderCards() {
  const orderedCards = [...cards].sort((left, right) =>
    Number(right.pinned) - Number(left.pinned) || left.createdAt - right.createdAt
  );
  elements.cardGrid.replaceChildren();
  elements.ideaCount.textContent = `${cards.length} ${cards.length === 1 ? "idea" : "ideas"}`;
  elements.navCardCount.textContent = String(cards.length);
  if (!orderedCards.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<span aria-hidden=\"true\">✦</span><strong>Your desk is yours to fill.</strong><p>Catch a thought before it drifts away. Start with one small idea.</p>";
    elements.cardGrid.append(empty);
    return;
  }

  for (const card of orderedCards) {
    const article = document.createElement("article");
    const tone = ["featured", "pink", "lilac"].includes(card.tone) ? card.tone : "";
    article.className = `idea-card${tone ? ` card-${tone}` : ""}`;
    article.dataset.cardId = card.id;
    const tags = Array.isArray(card.tags) ? card.tags : [];
    const safeTitle = escapeHTML(card.title || "Untitled idea");
    const safeDescription = escapeHTML(card.description || "");
    const safeCategory = escapeHTML(card.category || "YOUR IDEA");
    const tagMarkup = tags.map((tag) => `<span class="card-tag">${escapeHTML(tag)}</span>`).join("");
    article.innerHTML = `
      <div class="card-main">
        <div class="card-topline">
          <span class="card-category">${safeCategory}</span>
          <span class="card-menu">
            <button class="card-action" type="button" data-action="pin" aria-label="${card.pinned ? "Unpin" : "Pin"} ${safeTitle}" title="${card.pinned ? "Unpin idea" : "Pin idea"}">${card.pinned ? "⌖" : "⌁"}</button>
            <button class="card-action" type="button" data-action="delete" aria-label="Delete ${safeTitle}" title="Delete idea">×</button>
          </span>
        </div>
        <h3 class="card-title">${safeTitle}</h3>
        <p class="card-description">${safeDescription}</p>
        <div class="card-tags">${tagMarkup}</div>
      </div>
      ${tone === "featured" ? `<div class="featured-illustration" aria-hidden="true">
        <div class="desk-illustration"><div class="illustration-sun"></div><div class="illustration-blob"></div>
          <div class="illustration-paper"><div class="paper-line"></div><div class="paper-line"></div><div class="paper-line"></div><div class="paper-line"></div><div class="paper-stamp">✦</div></div>
          <div class="illustration-leaf"></div>
        </div>
      </div>` : ""}`;
    elements.cardGrid.append(article);
  }
}

function renderMessages() {
  elements.chatMessages.replaceChildren();
  elements.chatWelcome.classList.toggle("is-hidden", messages.length > 0);
  elements.chatMessages.classList.toggle("is-visible", messages.length > 0);
  for (const message of messages) {
    const article = document.createElement("article");
    article.className = `chat-message ${message.role === "user" ? "user-message" : "assistant-message"}`;
    const label = message.role === "user" ? "You" : "AirDesk AI";
    article.innerHTML = `<div class="message-label">${label}</div><div class="message-bubble">${safeMarkdown(message.content || "")}</div>`;
    if (message.role === "assistant" && message.content) {
      const saveButton = document.createElement("button");
      saveButton.className = "message-card-action";
      saveButton.type = "button";
      saveButton.dataset.action = "save-reply";
      saveButton.textContent = "＋ Save as an idea";
      article.append(saveButton);
    }
    elements.chatMessages.append(article);
  }
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function showToast(text) {
  elements.toast.textContent = text;
  elements.toast.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3000);
}

function normalizeEndpoint(value) {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Enter a valid local companion address.");
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("For your safety, AirDesk only connects to a companion running on this device.");
  }
  return parsed.origin;
}

async function requestJSON(path, options = {}) {
  const endpoint = normalizeEndpoint(settings.endpoint);
  const response = await fetch(`${endpoint}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    signal: options.signal
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Local companion responded with ${response.status}.`);
  return result;
}

function setConnectionState(connected, statusText) {
  const state = connected ? "connected" : "disconnected";
  elements.connectionPill.dataset.state = state;
  elements.connectionLabel.textContent = connected ? "Ollama connected" : "AI not connected";
  elements.chatStatusDot.className = `mini-status-dot ${state}`;
  elements.chatStatusLabel.textContent = connected ? "Connected to your local Ollama" : "Connect your local AI in settings";
  elements.settingsStatus.dataset.state = state;
  elements.settingsStatus.lastElementChild.textContent = statusText || (connected ? "Connected to your local Ollama." : "Not connected — your notes still work offline.");
}

async function checkConnection() {
  elements.connectionPill.dataset.state = "checking";
  elements.connectionLabel.textContent = "Checking Ollama";
  try {
    const status = await requestJSON("/api/status", { method: "GET", headers: {} });
    setConnectionState(Boolean(status.ollama), status.ollama
      ? `Ollama is ready${status.models?.includes(settings.model) ? ` · ${settings.model} is available` : ` · install ${settings.model} to chat`}.`
      : "Companion is running, but Ollama did not respond. Start Ollama and try again.");
    return Boolean(status.ollama);
  } catch (error) {
    setConnectionState(false, error instanceof TypeError
      ? "Companion not found. Start it with python companion/server.py."
      : error.message);
    return false;
  }
}

function openSettings() {
  elements.endpointInput.value = settings.endpoint;
  elements.modelInput.value = settings.model;
  document.querySelector("#high-contrast-toggle").checked = Boolean(settings.highContrast);
  elements.settingsDialog.showModal();
  checkConnection();
}

function saveSettings() {
  try {
    settings = {
      endpoint: normalizeEndpoint(elements.endpointInput.value.trim()),
      model: elements.modelInput.value.trim() || DEFAULT_SETTINGS.model,
      highContrast: document.querySelector("#high-contrast-toggle").checked
    };
    store(STORAGE_KEYS.settings, settings);
    elements.modelLabel.textContent = settings.model;
    document.body.classList.toggle("high-contrast", settings.highContrast);
    elements.settingsDialog.close();
    showToast("Your local AI settings are saved.");
    checkConnection();
  } catch (error) {
    elements.settingsStatus.dataset.state = "disconnected";
    elements.settingsStatus.lastElementChild.textContent = error.message;
  }
}

function openNoteDialog() {
  elements.noteHeading.value = "";
  elements.noteBody.value = "";
  elements.noteDialog.showModal();
  window.setTimeout(() => elements.noteHeading.focus(), 0);
}

function saveIdea(title, description, tone = "pink") {
  const cleanTitle = String(title || "").trim().slice(0, 90);
  const cleanDescription = String(description || "").trim().slice(0, 1200);
  if (!cleanTitle && !cleanDescription) {
    showToast("Add a few words before saving this idea.");
    return false;
  }
  cards.unshift({
    id: makeId(),
    title: cleanTitle || "A thought to come back to",
    description: cleanDescription,
    category: "JUST CAPTURED",
    tags: ["New idea"],
    tone,
    pinned: false,
    createdAt: Date.now()
  });
  store(STORAGE_KEYS.cards, cards);
  renderCards();
  return true;
}

function submitNote() {
  if (saveIdea(elements.noteHeading.value, elements.noteBody.value)) {
    elements.noteDialog.close();
    showToast("Your idea is on the desk.");
  }
}

function setBusy(value) {
  busy = value;
  elements.chatThinking.hidden = !value;
  elements.sendButton.disabled = value;
  elements.chatInput.disabled = value;
  if (!value) elements.chatInput.focus();
}

async function sendMessage(text = elements.chatInput.value) {
  const prompt = text.trim();
  if (!prompt || busy) return;
  if (messages.length === 0) messages = [HELLO_MESSAGE];
  messages.push({ role: "user", content: prompt, time: Date.now() });
  store(STORAGE_KEYS.messages, messages);
  renderMessages();
  elements.chatInput.value = "";
  resizeComposer();

  setBusy(true);
  try {
    const conversation = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-32)
      .map(({ role, content }) => ({ role, content }));
    const result = await requestJSON("/api/chat", {
      method: "POST",
      body: JSON.stringify({ model: settings.model, messages: conversation })
    });
    if (!result.message?.content) throw new Error("Ollama returned an empty reply. Try again or check the model.");
    messages.push({ role: "assistant", content: result.message.content, time: Date.now() });
    store(STORAGE_KEYS.messages, messages);
    renderMessages();
  } catch (error) {
    messages.push({
      role: "assistant",
      content: `I couldn't reach your local AI just now. ${error instanceof TypeError
        ? "Check that the AirDesk companion and Ollama are running, then try again."
        : error.message}`,
      time: Date.now(),
      error: true
    });
    store(STORAGE_KEYS.messages, messages);
    renderMessages();
    showToast("The message could not be sent. Your notes are still safe.");
  } finally {
    setBusy(false);
  }
}

function resizeComposer() {
  elements.chatInput.style.height = "auto";
  elements.chatInput.style.height = `${Math.min(elements.chatInput.scrollHeight, 115)}px`;
}

function handleCardAction(event) {
  const actionButton = event.target.closest("[data-action]");
  const card = event.target.closest("[data-card-id]");
  if (!actionButton || !card) return;
  const target = cards.find((item) => item.id === card.dataset.cardId);
  if (!target) return;
  if (actionButton.dataset.action === "pin") {
    target.pinned = !target.pinned;
    store(STORAGE_KEYS.cards, cards);
    renderCards();
    showToast(target.pinned ? "Idea pinned to the top of your desk." : "Idea unpinned.");
  } else if (actionButton.dataset.action === "delete") {
    if (!window.confirm("Delete this idea? This cannot be undone unless you have an encrypted backup.")) return;
    cards = cards.filter((item) => item.id !== target.id);
    store(STORAGE_KEYS.cards, cards);
    renderCards();
    showToast("Idea removed from your desk.");
  }
}

function startNewChat() {
  if (messages.length && !window.confirm("Clear this conversation? The messages cannot be recovered unless you have an encrypted backup.")) return;
  messages = [];
  store(STORAGE_KEYS.messages, messages);
  renderMessages();
  elements.chatInput.focus();
  showToast("A fresh conversation, whenever you're ready.");
}

function init() {
  setDate();
  elements.modelLabel.textContent = settings.model;
  document.body.classList.toggle("high-contrast", Boolean(settings.highContrast));
  renderCards();
  renderMessages();
  elements.endpointInput.value = settings.endpoint;
  elements.modelInput.value = settings.model;
  checkConnection();

  document.querySelector("#top-settings-button").addEventListener("click", openSettings);
  document.querySelector("#save-settings-button").addEventListener("click", saveSettings);
  document.querySelector("#check-connection-button").addEventListener("click", checkConnection);
  document.querySelector("#new-chat-button").addEventListener("click", startNewChat);
  elements.cardGrid.addEventListener("click", handleCardAction);
  elements.chatMessages.addEventListener("click", (event) => {
    if (!event.target.closest('[data-action="save-reply"]')) return;
    const bubble = event.target.closest(".chat-message")?.querySelector(".message-bubble");
    const text = bubble?.innerText || "";
    if (saveIdea("A thought from our chat", text, "lilac")) showToast("Reply saved as an idea.");
  });
  elements.sendButton.addEventListener("click", () => sendMessage());
  elements.chatInput.addEventListener("input", resizeComposer);
  elements.chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      elements.chatInput.value = button.dataset.prompt;
      elements.chatInput.focus();
      resizeComposer();
    });
  });
  document.querySelector("#model-picker").addEventListener("click", openSettings);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("presenting")) {
      document.body.classList.remove("presenting");
      document.querySelector("#present-button span").textContent = "Read together";
      document.querySelector("#present-button").setAttribute("aria-pressed", "false");
    }
  });
}
