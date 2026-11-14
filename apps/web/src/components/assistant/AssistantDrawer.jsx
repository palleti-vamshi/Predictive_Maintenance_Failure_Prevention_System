import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useRouter } from '../../router/Router.jsx';
import Icon from '../common/Icon.jsx';
import { USER_ROLES } from '@predictive-maintenance/shared';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

const STORAGE_KEY = 'pm_copilot_window_state';
const TARGET_DEFAULT_WIDTH = 380; // Desktop target width: ~380 px (360-420 px range)

/**
 * Returns the sensible minimum width (340px).
 */
function getMinWidth() {
  return 340;
}

/**
 * Returns the maximum width on desktop.
 * Enforces that Copilot never covers half the website:
 * Capped at 40% of viewport width with an absolute limit of 420px.
 */
function getMaxWidth(viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1200) {
  return Math.max(340, Math.min(420, Math.floor(viewportWidth * 0.40)));
}

/**
 * Calculates default height: target ~68vh (between 560px and 640px),
 * providing ample vertical breathing room for long multi-item responses.
 */
function getDefaultHeight(viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800) {
  return Math.min(640, Math.max(560, Math.round(viewportHeight * 0.68)));
}

/**
 * Returns minimum height on desktop (~50vh or at least 460px).
 */
function getMinHeight(viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800) {
  return Math.min(500, Math.max(460, Math.round(viewportHeight * 0.52)));
}

/**
 * Returns maximum height on desktop (strictly capped at 680px).
 */
function getMaxHeight(viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 800) {
  return Math.min(680, Math.max(560, Math.round(viewportHeight * 0.74)));
}

/**
 * Calculates a safe on-screen position bounded by current browser viewport.
 */
function getSafePosition(x, y, width, height) {
  if (typeof window === 'undefined') return { x: 20, y: 20 };
  const minX = 12;
  const maxX = Math.max(minX, window.innerWidth - width - 12);
  const minY = 12;
  const maxY = Math.max(minY, window.innerHeight - height - 12);

  const safeX = Math.max(minX, Math.min(maxX, x ?? (window.innerWidth - width - 20)));
  const safeY = Math.max(minY, Math.min(maxY, y ?? Math.max(16, (window.innerHeight - height) / 2)));
  return { x: safeX, y: safeY };
}

/**
 * Loads persistent floating window geometry (position and dimensions only).
 * Note: Zero chat content is ever persisted in localStorage for privacy.
 */
function loadSavedWindowState() {
  const vW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vH = typeof window !== 'undefined' ? window.innerHeight : 800;
  const minW = getMinWidth();
  const maxW = getMaxWidth(vW);
  const minH = getMinHeight(vH);
  const maxH = getMaxHeight(vH);
  const defaultW = TARGET_DEFAULT_WIDTH;
  const defaultH = getDefaultHeight(vH);

  if (typeof window === 'undefined') {
    return { x: 20, y: 20, width: defaultW, height: defaultH, isMinimized: false };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      let width = parsed.width || defaultW;
      let height = parsed.height || defaultH;

      // Migrate or clamp stored dimensions so it strictly honors target (380px, roomy height 560-640px)
      if (width > maxW) {
        width = Math.min(maxW, Math.max(minW, TARGET_DEFAULT_WIDTH));
      } else if (width < TARGET_DEFAULT_WIDTH && vW >= 768) {
        width = TARGET_DEFAULT_WIDTH;
      }

      // Upgrade cramped stored height if below 550px on normal desktop displays
      if (height < 550 && vH >= 650) {
        height = defaultH;
      } else if (height > maxH) {
        height = maxH;
      } else if (height < minH) {
        height = minH;
      }

      const pos = getSafePosition(parsed.x, parsed.y, width, height);
      return {
        x: pos.x,
        y: pos.y,
        width,
        height,
        isMinimized: Boolean(parsed.isMinimized)
      };
    }
  } catch (e) {
    console.warn('[Copilot] Could not parse stored window state:', e);
  }

  const width = defaultW;
  const height = defaultH;
  const pos = getSafePosition(vW - width - 20, Math.max(16, (vH - height) / 2), width, height);
  return {
    x: pos.x,
    y: pos.y,
    width,
    height,
    isMinimized: false
  };
}

function saveWindowState(state) {
  if (typeof window === 'undefined') return;
  try {
    const toSave = {
      x: Math.round(state.x),
      y: Math.round(state.y),
      width: Math.round(state.width),
      height: Math.round(state.height),
      isMinimized: Boolean(state.isMinimized)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch (e) {}
}

/**
 * Fallback contextual suggestions if API is unreachable.
 */
const DEFAULT_SUGGESTIONS = [
  { label: 'Condition of GB-104', query: 'What is the diagnostic condition of GB-104?', mode: 'factory' },
  { label: 'Factory shift briefing', query: 'Provide factory shift briefing', mode: 'factory' },
  { label: 'Active alerts summary', query: 'Show active warning and critical alerts', mode: 'factory' },
  { label: 'Explain Random Forest & SHAP', query: 'Explain how SHAP and Random Forest work in this app', mode: 'factory' },
  { label: 'Draft work order for GB-104', query: 'Draft work order for GB-104', mode: 'factory' },
  { label: 'ISO 10816 vibration standards', query: 'What are the ISO 10816 vibration severity standards for industrial gearboxes?', mode: 'general' }
];

/**
 * Renders an inline mathematical formula safely as formatted JSX elements.
 * Converts LaTeX notation (\text{}, \cdot, \pm, subscripts, superscripts, variables)
 * into high-contrast, beautiful mathematical typography.
 */
function renderMathFormula(mathStr, key) {
  if (!mathStr || typeof mathStr !== 'string') return null;

  const isDisplay = mathStr.startsWith('$$') && mathStr.endsWith('$$');
  let str = mathStr.replace(/^\$+|\$+$/g, '').trim();

  // Robust LaTeX cleanups (supports single, double, or escaped backslashes)
  str = str.replace(/\\+text\{([^}]+)\}/g, '$1');
  str = str.replace(/\\+mathrm\{([^}]+)\}/g, '$1');
  str = str.replace(/\\+mathbf\{([^}]+)\}/g, '$1');
  str = str.replace(/\\+mathit\{([^}]+)\}/g, '$1');
  str = str.replace(/\\+cdot/g, ' · ');
  str = str.replace(/\\+pm/g, ' ± ');
  str = str.replace(/\\+mp/g, ' ∓ ');
  str = str.replace(/\\+times/g, ' × ');
  str = str.replace(/\\+leq?/g, ' ≤ ');
  str = str.replace(/\\+geq?/g, ' ≥ ');
  str = str.replace(/\\+neq/g, ' ≠ ');
  str = str.replace(/\\+approx/g, ' ≈ ');
  str = str.replace(/\\+sim/g, ' ~ ');
  str = str.replace(/\\+infty/g, '∞');
  str = str.replace(/\\+dots/g, '…');
  str = str.replace(/\\+ldots/g, '…');
  str = str.replace(/\\+Delta/g, 'Δ');
  str = str.replace(/\\+omega/g, 'ω');
  str = str.replace(/\\+Omega/g, 'Ω');
  str = str.replace(/\\+pi/g, 'π');
  str = str.replace(/\\+sigma/g, 'σ');
  str = str.replace(/\\+mu/g, 'μ');
  str = str.replace(/\\+alpha/g, 'α');
  str = str.replace(/\\+beta/g, 'β');
  str = str.replace(/\\+theta/g, 'θ');
  str = str.replace(/\\+lambda/g, 'λ');
  str = str.replace(/\\+phi/g, 'ϕ');
  str = str.replace(/\\+/g, '');
  str = str.replace(/\s+/g, ' ');

  const tokenRegex =
    /([a-zA-Zα-ωΩΔ]+)_(?:\{([^}]+)\}|([a-zA-Z0-9]+))|([a-zA-Zα-ωΩΔ]+)\^(?:\{([^}]+)\}|([a-zA-Z0-9]+))|([a-zA-Zα-ωΩΔ])|([0-9]+(?:\.[0-9]+)?)|([=+\-·±∓<>≤≥≠≈~×/]+)|([(),]+)|([^a-zA-Z0-9\s]+)|(\s+)/g;
  let m;
  const elements = [];
  let tokenIdx = 0;

  while ((m = tokenRegex.exec(str)) !== null) {
    const tKey = `${key}-${tokenIdx++}`;
    if (m[1]) {
      // Subscript: base variable + sub
      elements.push(
        <span key={tKey} className="math-var-sub">
          <em className="math-var">{m[1]}</em>
          <sub className="math-sub">{m[2] || m[3]}</sub>
        </span>
      );
    } else if (m[4]) {
      // Superscript: base variable + sup
      elements.push(
        <span key={tKey} className="math-var-sup">
          <em className="math-var">{m[4]}</em>
          <sup className="math-sup">{m[5] || m[6]}</sup>
        </span>
      );
    } else if (m[7]) {
      // Single letter variable
      elements.push(
        <em key={tKey} className="math-var">
          {m[7]}
        </em>
      );
    } else if (m[8]) {
      // Number
      elements.push(
        <span key={tKey} className="math-num">
          {m[8]}
        </span>
      );
    } else if (m[9]) {
      // Operator
      const op = m[9] === '-' ? '−' : m[9];
      elements.push(
        <span key={tKey} className="math-op">
          {op}
        </span>
      );
    } else if (m[10]) {
      // Parentheses or comma
      elements.push(
        <span key={tKey} className="math-paren">
          {m[10]}
        </span>
      );
    } else if (m[11]) {
      elements.push(
        <span key={tKey} className="math-sym">
          {m[11]}
        </span>
      );
    } else if (m[12]) {
      elements.push(' ');
    }
  }

  return (
    <span key={key} className={isDisplay ? 'msg-display-formula' : 'msg-math-formula'}>
      {elements}
    </span>
  );
}

/**
 * Safely parses inline markdown tokens: **bold**, `code`, *italic*, and $math$.
 */
function renderInlineMarkdown(text) {
  if (!text || typeof text !== 'string') return null;

  // Supports: $$display_math$$, $inline_math$, **bold**, `code`, *italic*
  const regex = /(\$\$[^\$]+?\$\$|\$[^\$]+?\$|\*\*[^*]+?\*\*|`[^`]+?`|\*[^*]+?\*)/g;
  const segments = text.split(regex);

  return segments.map((seg, idx) => {
    if (!seg) return null;

    // Display or Inline Math
    if (seg.startsWith('$') && seg.endsWith('$') && seg.length >= 2) {
      return renderMathFormula(seg, idx);
    }

    // Bold
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length >= 4) {
      return (
        <strong key={idx} className="msg-strong">
          {renderInlineMarkdown(seg.slice(2, -2))}
        </strong>
      );
    }

    // Inline Code
    if (seg.startsWith('`') && seg.endsWith('`') && seg.length >= 2) {
      return (
        <code key={idx} className="inline-code">
          {seg.slice(1, -1)}
        </code>
      );
    }

    // Italic
    if (seg.startsWith('*') && seg.endsWith('*') && seg.length >= 2) {
      return (
        <em key={idx} className="msg-em">
          {seg.slice(1, -1)}
        </em>
      );
    }

    return seg;
  });
}

/**
 * Parses raw text into semantic structured markdown blocks:
 * paragraphs, bullet lists, numbered lists, headers, blockquotes, and tables.
 * Handles multi-line list continuations properly without breaking items into paragraphs.
 */
function parseMessageBlocks(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];

  const lines = rawText.split('\n');
  const blocks = [];
  let currentParagraph = [];
  let currentBulletList = [];
  let currentNumberedList = [];
  let currentTable = [];

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      blocks.push({ type: 'paragraph', text: currentParagraph.join(' ') });
      currentParagraph = [];
    }
  };

  const flushBulletList = () => {
    if (currentBulletList.length > 0) {
      blocks.push({ type: 'bullet-list', items: [...currentBulletList] });
      currentBulletList = [];
    }
  };

  const flushNumberedList = () => {
    if (currentNumberedList.length > 0) {
      blocks.push({ type: 'numbered-list', items: [...currentNumberedList] });
      currentNumberedList = [];
    }
  };

  const flushTable = () => {
    if (currentTable.length > 0) {
      blocks.push({ type: 'table', lines: [...currentTable] });
      currentTable = [];
    }
  };

  const flushAll = () => {
    flushParagraph();
    flushBulletList();
    flushNumberedList();
    flushTable();
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushAll();
      continue;
    }

    // Markdown Table line
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushParagraph();
      flushBulletList();
      flushNumberedList();
      currentTable.push(trimmed);
      continue;
    } else if (currentTable.length > 0) {
      flushTable();
    }

    // Headers
    if (trimmed.startsWith('### ')) {
      flushAll();
      blocks.push({ type: 'h3', text: trimmed.replace(/^###\s+/, '') });
      continue;
    }
    if (trimmed.startsWith('#### ')) {
      flushAll();
      blocks.push({ type: 'h4', text: trimmed.replace(/^####\s+/, '') });
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      flushAll();
      blocks.push({ type: 'blockquote', text: trimmed.replace(/^>\s+/, '') });
      continue;
    }

    // Numbered List line: e.g. 1. item
    if (/^\d+\.\s/.test(trimmed)) {
      flushParagraph();
      flushBulletList();
      currentNumberedList.push(trimmed.replace(/^\d+\.\s+/, ''));
      continue;
    }

    // Bullet List line: - item or * item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      flushParagraph();
      flushNumberedList();
      currentBulletList.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }

    // Continuation line of an existing list item
    if (currentNumberedList.length > 0) {
      currentNumberedList[currentNumberedList.length - 1] += ' ' + trimmed;
      continue;
    }
    if (currentBulletList.length > 0) {
      currentBulletList[currentBulletList.length - 1] += ' ' + trimmed;
      continue;
    }

    // Regular line inside a paragraph
    currentParagraph.push(trimmed);
  }

  flushAll();
  return blocks;
}

/**
 * Renders structured markdown content safely with proper spacing and lists.
 */
function renderMessageBody(rawText) {
  if (!rawText) return null;
  const blocks = parseMessageBlocks(rawText);

  return blocks.map((block, bIdx) => {
    if (block.type === 'h3') {
      return (
        <h3 key={bIdx} className="msg-h3">
          {renderInlineMarkdown(block.text)}
        </h3>
      );
    }
    if (block.type === 'h4') {
      return (
        <h4 key={bIdx} className="msg-h4">
          {renderInlineMarkdown(block.text)}
        </h4>
      );
    }
    if (block.type === 'blockquote') {
      return (
        <blockquote key={bIdx} className="msg-blockquote">
          {renderInlineMarkdown(block.text)}
        </blockquote>
      );
    }
    if (block.type === 'bullet-list') {
      return (
        <ul key={bIdx} className="msg-bullet-list">
          {block.items.map((item, iIdx) => (
            <li key={iIdx}>{renderInlineMarkdown(item)}</li>
          ))}
        </ul>
      );
    }
    if (block.type === 'numbered-list') {
      return (
        <ol key={bIdx} className="msg-numbered-list">
          {block.items.map((item, iIdx) => (
            <li key={iIdx} className="msg-numbered-item">
              <span className="msg-num-badge" aria-hidden="true">{iIdx + 1}</span>
              <div className="msg-item-body">{renderInlineMarkdown(item)}</div>
            </li>
          ))}
        </ol>
      );
    }
    if (block.type === 'table') {
      if (block.lines.length >= 2) {
        const headerCells = block.lines[0]
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        const bodyLines = block.lines.slice(2);
        return (
          <div key={bIdx} className="msg-table-wrapper">
            <table className="msg-table">
              <thead>
                <tr>
                  {headerCells.map((h, hIdx) => (
                    <th key={hIdx}>{renderInlineMarkdown(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bodyLines.map((row, rIdx) => {
                  const cells = row
                    .split('|')
                    .slice(1, -1)
                    .map((c) => c.trim());
                  return (
                    <tr key={rIdx}>
                      {cells.map((cell, cIdx) => (
                        <td key={cIdx}>{renderInlineMarkdown(cell)}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      }
    }
    // Paragraph
    return (
      <p key={bIdx} className="msg-paragraph">
        {renderInlineMarkdown(block.text)}
      </p>
    );
  });
}

export default function AssistantDrawer({ isOpen, onClose, onActivityChange, restoreTrigger }) {
  const { user } = useAuth();
  const { routeKey, params, navigate } = useRouter();

  // Floating Window Geometry & State
  const [windowState, setWindowState] = useState(loadSavedWindowState);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isMobile, setIsMobile] = useState(typeof window !== 'undefined' ? window.innerWidth < 768 : false);

  const dragRef = useRef(null);
  const resizeRef = useRef(null);

  // Chat conversation state
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [activeMode, setActiveMode] = useState('auto'); // 'auto' | 'factory' | 'general'
  const [dynamicSuggestions, setDynamicSuggestions] = useState(DEFAULT_SUGGESTIONS);
  const [isLoading, setIsLoading] = useState(false);
  const [recentSuccess, setRecentSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [approvingDraftId, setApprovingDraftId] = useState(null);
  const [approvedOrders, setApprovedOrders] = useState({});
  const [approvalError, setApprovalError] = useState(null);

  const messagesEndRef = useRef(null);
  const latestMsgRef = useRef(null);
  const inputRef = useRef(null);
  const headerRef = useRef(null);
  const bodyRef = useRef(null);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const checkScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
    setCanScrollDown(remaining > 28);
  }, []);

  const isManager = user?.role === USER_ROLES.FACTORY_MANAGER;
  const currentMachineCode = params?.id || null;

  // Sync activity with companion mascot (MechMitra)
  useEffect(() => {
    if (typeof onActivityChange === 'function') {
      onActivityChange({
        isLoading,
        isListening: isInputFocused || Boolean(inputValue && inputValue.trim().length > 0),
        isMinimized: Boolean(windowState.isMinimized),
        scopedAlertCount: status?.scope?.scopedAlertCount || 0,
        recentSuccess
      });
    }
  }, [isLoading, isInputFocused, inputValue, windowState.isMinimized, status, recentSuccess, onActivityChange]);

  // Handle external restore command (e.g. user clicked MechMitra while Copilot was minimized)
  useEffect(() => {
    if (restoreTrigger && windowState.isMinimized) {
      setWindowState((prev) => {
        const updated = { ...prev, isMinimized: false };
        saveWindowState(updated);
        return updated;
      });
    }
  }, [restoreTrigger]);

  // Window resize & safe bounds clamping listener
  useEffect(() => {
    const handleViewportResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (!mobile) {
        setWindowState((prev) => {
          const vW = window.innerWidth;
          const vH = window.innerHeight;
          const minW = getMinWidth();
          const maxW = getMaxWidth(vW);
          const minH = getMinHeight(vH);
          const maxH = getMaxHeight(vH);

          let newW = prev.width;
          let newH = prev.height;

          if (newW > maxW) newW = maxW;
          if (newW < TARGET_DEFAULT_WIDTH) newW = TARGET_DEFAULT_WIDTH;
          if (newH < 500 && vH >= 650) newH = getDefaultHeight(vH);
          else if (newH > maxH) newH = maxH;
          else if (newH < minH) newH = minH;

          const currentW = prev.isMinimized ? 300 : newW;
          const currentH = prev.isMinimized ? 48 : newH;
          const safe = getSafePosition(prev.x, prev.y, currentW, currentH);
          if (safe.x !== prev.x || safe.y !== prev.y || newW !== prev.width || newH !== prev.height) {
            const updated = { ...prev, x: safe.x, y: safe.y, width: newW, height: newH };
            saveWindowState(updated);
            return updated;
          }
          return prev;
        });
      }
    };

    window.addEventListener('resize', handleViewportResize);
    return () => window.removeEventListener('resize', handleViewportResize);
  }, []);

  // Keyboard Shortcuts: Escape to close, Ctrl+M / Cmd+M to minimize/restore
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        setWindowState((prev) => {
          const updated = { ...prev, isMinimized: !prev.isMinimized };
          saveWindowState(updated);
          return updated;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Load Assistant Provider & Scoping Status
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    async function loadStatus() {
      try {
        const res = await fetch(`${API_BASE}/assistant/status`, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        if (res.ok && isMounted) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (err) {
        console.warn('Could not fetch assistant status:', err);
      }
    }

    loadStatus();

    // Initial Welcome message if thread is empty
    if (messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          sender: 'assistant',
          mode: 'factory',
          text: `Hello ${user?.fullName || 'Engineer'}. I am **MechGuard Copilot**, your movable, practical industrial maintenance and reliability copilot.\n\nI assist with two operational modes:\n- **Factory Records & Diagnostics**: Query authorized equipment condition, inspect vibration telemetry, analyze active alerts, and prepare draft maintenance proposals for **${user?.factoryId?.name || 'your assigned plant'}**.\n- **General Engineering**: Inquire about ISO 10816 vibration severity standards, failure modes (bearing spalling, gear tooth wear), and machine learning methodology (Random Forest, Isolation Forest, TreeSHAP).`,
          facts: [
            `Authorized factory: ${user?.factoryId?.name || 'Local Plant'}.`,
            isManager
              ? 'Role: Factory Manager (Full factory equipment and work order dispatch authority).'
              : 'Role: Technician (Scoped to assigned equipment and tasks).'
          ],
          modelOutputs: [],
          recommendations: [
            'Click any page-aware suggestion chip below or enter an operational question.'
          ],
          citations: [],
          workOrderDraft: null,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    }

    if (!windowState.isMinimized) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 140);
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen, user, isManager, windowState.isMinimized]);

  // Load Page-Aware Contextual Suggestions based on active route and machine
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    async function loadSuggestions() {
      try {
        const machineCode = currentMachineCode || '';
        const url = `${API_BASE}/assistant/suggestions?route=${encodeURIComponent(routeKey || '')}&machineCode=${encodeURIComponent(machineCode)}`;
        const res = await fetch(url, {
          credentials: 'include',
          headers: { Accept: 'application/json' }
        });
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data.suggestions && data.suggestions.length > 0) {
            setDynamicSuggestions(data.suggestions);
          }
        }
      } catch (err) {
        console.warn('Could not fetch dynamic suggestions:', err);
      }
    }

    loadSuggestions();
    return () => {
      isMounted = false;
    };
  }, [isOpen, routeKey, currentMachineCode]);

  // Scroll smoothly to start of new assistant response or bottom on user query
  useEffect(() => {
    if (isOpen && !windowState.isMinimized) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.sender === 'assistant' && latestMsgRef.current) {
        latestMsgRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
      setTimeout(checkScroll, 150);
    }
  }, [isOpen, messages, isLoading, windowState.isMinimized, checkScroll]);

  // Dragging by Header (Desktop)
  const handleHeaderPointerDown = (e) => {
    if (isMobile) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    // Do not initiate drag if clicking buttons, inputs, links, or tabs
    if (e.target.closest('button, input, select, textarea, a, [role="tab"], .no-drag')) {
      return;
    }

    e.preventDefault();
    setIsDragging(true);

    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: windowState.x,
      initialY: windowState.y
    };

    const handlePointerMove = (moveEvent) => {
      if (!dragRef.current) return;
      const dx = moveEvent.clientX - dragRef.current.startX;
      const dy = moveEvent.clientY - dragRef.current.startY;
      const currentW = windowState.isMinimized ? 300 : windowState.width;
      const currentH = windowState.isMinimized ? 48 : windowState.height;
      const safePos = getSafePosition(
        dragRef.current.initialX + dx,
        dragRef.current.initialY + dy,
        currentW,
        currentH
      );
      setWindowState((prev) => ({
        ...prev,
        x: safePos.x,
        y: safePos.y
      }));
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      dragRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      setWindowState((latest) => {
        saveWindowState(latest);
        return latest;
      });
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // Resizing from Corner Handles (Desktop)
  const handleResizePointerDown = (e, direction = 'se') => {
    if (isMobile || windowState.isMinimized) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);

    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialWidth: windowState.width,
      initialHeight: windowState.height,
      initialX: windowState.x,
      direction
    };

    const handleResizeMove = (moveEvent) => {
      if (!resizeRef.current) return;
      const dx = moveEvent.clientX - resizeRef.current.startX;
      const dy = moveEvent.clientY - resizeRef.current.startY;

      const vW = window.innerWidth;
      const vH = window.innerHeight;
      const minW = getMinWidth();
      const maxW = getMaxWidth(vW);
      const minH = getMinHeight(vH);
      const maxH = getMaxHeight(vH);

      let newWidth = resizeRef.current.initialWidth;
      let newHeight = resizeRef.current.initialHeight;
      let newX = resizeRef.current.initialX;

      if (resizeRef.current.direction === 'se') {
        newWidth = Math.max(minW, Math.min(maxW, resizeRef.current.initialWidth + dx));
        newHeight = Math.max(minH, Math.min(maxH, resizeRef.current.initialHeight + dy));
      } else if (resizeRef.current.direction === 'sw') {
        const rawW = resizeRef.current.initialWidth - dx;
        newWidth = Math.max(minW, Math.min(maxW, rawW));
        newHeight = Math.max(minH, Math.min(maxH, resizeRef.current.initialHeight + dy));
        newX = resizeRef.current.initialX + (resizeRef.current.initialWidth - newWidth);
      }

      const safe = getSafePosition(newX, windowState.y, newWidth, newHeight);
      setWindowState((prev) => ({
        ...prev,
        width: newWidth,
        height: newHeight,
        x: safe.x
      }));
    };

    const handleResizeUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', handleResizeUp);
      setWindowState((latest) => {
        saveWindowState(latest);
        return latest;
      });
    };

    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handleResizeUp);
  };

  // Keyboard Accessible Moving via Arrow Keys when header is focused
  const handleHeaderKeyDown = (e) => {
    if (isMobile) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 60 : 20;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;

      setWindowState((prev) => {
        const currentW = prev.isMinimized ? 300 : prev.width;
        const currentH = prev.isMinimized ? 48 : prev.height;
        const safe = getSafePosition(prev.x + dx, prev.y + dy, currentW, currentH);
        const updated = { ...prev, x: safe.x, y: safe.y };
        saveWindowState(updated);
        return updated;
      });
    }
  };

  const handleSend = async (queryText, overrideMode = null) => {
    const textToSend = queryText || inputValue;
    if (!textToSend || !textToSend.trim() || isLoading) return;

    const targetMode = overrideMode || activeMode;
    if (overrideMode && overrideMode !== activeMode) {
      setActiveMode(overrideMode);
    }

    const userMsg = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: textToSend.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/assistant/query`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          query: textToSend.trim(),
          machineCode: currentMachineCode,
          mode: targetMode
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Server returned ${res.status}`);
      }

      const data = await res.json();
      const assistantMsg = {
        id: `assistant-${Date.now()}`,
        sender: 'assistant',
        mode: data.mode || (targetMode === 'general' ? 'general' : 'factory'),
        generalGuidance: data.generalGuidance || null,
        text: data.answer || 'Response generated from authorized factory records.',
        facts: data.facts || [],
        modelOutputs: data.modelOutputs || [],
        recommendations: data.recommendations || [],
        citations: data.citations || [],
        workOrderDraft: data.workOrderDraft || null,
        provider: data.provider || null,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setRecentSuccess(true);
      setTimeout(() => {
        setRecentSuccess(false);
      }, 2800);
    } catch (err) {
      setError(err.message);
      setRecentSuccess(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          sender: 'assistant',
          isError: true,
          text: `⚠️ Request could not be completed: ${err.message}\n\nPlease check network connectivity or try another question.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCitationClick = (url) => {
    if (!url) return;
    navigate(url);
    if (isMobile) {
      onClose();
    }
  };

  const handleApproveDraft = async (msgId, draft) => {
    try {
      setApprovingDraftId(msgId);
      setApprovalError(null);

      const res = await fetch(`${API_BASE}/assistant/approve-draft-work-order`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ draft })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Failed to approve work order draft.');
      }

      setApprovedOrders((prev) => ({
        ...prev,
        [msgId]: data.workOrder
      }));
    } catch (err) {
      setApprovalError(err.message);
    } finally {
      setApprovingDraftId(null);
    }
  };

  if (!isOpen) return null;

  // Window content rendering
  const renderWindowContent = () => {
    if (windowState.isMinimized && !isMobile) {
      return (
        <div
          ref={headerRef}
          className="assistant-drawer-header assistant-header-minimized"
          onPointerDown={handleHeaderPointerDown}
          onKeyDown={handleHeaderKeyDown}
          tabIndex={0}
          role="region"
          aria-label="MechGuard Copilot Minimized. Drag to move, or click to restore."
          onClick={(e) => {
            if (!e.target.closest('button')) {
              setWindowState((prev) => {
                const updated = { ...prev, isMinimized: false };
                saveWindowState(updated);
                return updated;
              });
            }
          }}
        >
          <div className="copilot-drag-handle-indicator" title="Drag to move window">
            <Icon name="grip" size={13} color="#0f766e" />
          </div>
          <div className="assistant-header-icon-box" style={{ width: 28, height: 28, borderRadius: 6 }}>
            <Icon name="brandMark" size={16} color="#0f766e" />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              MechGuard Copilot
            </span>
            <span className={`status-dot ${status?.provider?.configured ? 'dot-active' : 'dot-ready'}`} style={{ display: 'inline-block' }} />
          </div>
          <div className="copilot-window-actions">
            <button
              type="button"
              className="copilot-window-btn"
              onClick={(e) => {
                e.stopPropagation();
                setWindowState((prev) => {
                  const updated = { ...prev, isMinimized: false };
                  saveWindowState(updated);
                  return updated;
                });
              }}
              title="Restore Copilot Window (Ctrl+M)"
              aria-label="Restore Copilot Window"
            >
              <Icon name="maximize" size={13} color="var(--text-muted)" />
            </button>
            <button
              type="button"
              className="copilot-window-btn copilot-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              title="Close Copilot (ESC)"
              aria-label="Close Copilot"
            >
              <Icon name="close" size={14} color="var(--text-muted)" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <>
        {/* Copilot Header */}
        <div
          ref={headerRef}
          className="assistant-drawer-header"
          onPointerDown={isMobile ? undefined : handleHeaderPointerDown}
          onKeyDown={isMobile ? undefined : handleHeaderKeyDown}
          tabIndex={isMobile ? -1 : 0}
          role="region"
          aria-label="MechGuard Copilot Floating Window. Drag header to move, or use arrow keys."
          style={{ cursor: isMobile ? 'default' : isDragging ? 'grabbing' : 'grab' }}
        >
          <div className="assistant-header-title-row">
            {!isMobile && (
              <div className="copilot-drag-handle-indicator" title="Drag to reposition window (or use arrow keys)">
                <Icon name="grip" size={14} color="#0f766e" />
              </div>
            )}
            <div className="assistant-header-icon-box">
              <Icon name="brandMark" size={18} color="#0f766e" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="assistant-header-title-with-pill">
                <h2 className="assistant-header-title">MechGuard Copilot</h2>
                <span className="copilot-version-pill">COPILOT</span>
              </div>
              <p className="assistant-header-subtitle">
                {user?.factoryId?.name || 'Authorized Factory'} • {isManager ? 'Manager Scope' : 'Technician Scope'}
              </p>
            </div>

            {/* Window Controls: Minimize & Close */}
            <div className="copilot-window-actions">
              {!isMobile && (
                <button
                  type="button"
                  className="copilot-window-btn"
                  onClick={() => {
                    setWindowState((prev) => {
                      const updated = { ...prev, isMinimized: true };
                      saveWindowState(updated);
                      return updated;
                    });
                  }}
                  title="Minimize window (Ctrl+M)"
                  aria-label="Minimize Copilot Window"
                >
                  <Icon name="minimize" size={14} color="var(--text-muted)" />
                </button>
              )}
              <button
                type="button"
                className="copilot-window-btn copilot-close-btn"
                onClick={onClose}
                aria-label="Close MechGuard Copilot"
                title="Close Copilot (ESC)"
              >
                <Icon name="close" size={16} color="var(--text-muted)" />
              </button>
            </div>
          </div>

          {/* Clean Truthful Status Banner */}
          <div className="assistant-provider-banner">
            <div className="provider-status-tag">
              <span className={`status-dot ${status?.provider?.configured ? 'dot-active' : 'dot-ready'}`} />
              <span className="provider-status-name">
                {status?.provider?.configured
                  ? 'Connected · Live cloud analysis'
                  : 'Ready · Authorized factory database mode'}
              </span>
            </div>
            <span className="provider-status-note">
              {status?.provider?.configured
                ? 'Answering with authorized equipment telemetry, verified ML models, and maintenance history.'
                : 'Operating in local analysis mode using verified equipment records, sensor baselines, and condition alerts.'}
            </span>
          </div>

          {/* Mode Selector Tabs */}
          <div className="assistant-mode-bar" role="tablist" aria-label="Query Mode">
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'auto'}
              className={`assistant-mode-btn ${activeMode === 'auto' ? 'active' : ''}`}
              onClick={() => setActiveMode('auto')}
              title="Auto Mode: Automatically routes between factory records and general engineering concepts"
              aria-label="Auto Mode"
            >
              <Icon name="activity" size={12} color={activeMode === 'auto' ? '#ffffff' : '#0f766e'} />
              <span>Auto</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'factory'}
              className={`assistant-mode-btn ${activeMode === 'factory' ? 'active' : ''}`}
              onClick={() => setActiveMode('factory')}
              title="Factory Mode: Strictly grounded in authorized equipment records and active alerts"
              aria-label="Factory Records Mode"
            >
              <Icon name="machine" size={12} color={activeMode === 'factory' ? '#ffffff' : '#0f766e'} />
              <span>Factory</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeMode === 'general'}
              className={`assistant-mode-btn ${activeMode === 'general' ? 'active' : ''}`}
              onClick={() => setActiveMode('general')}
              title="General Mode: ISO 10816 vibration standards, failure modes, and ML principles"
              aria-label="General Guidance Mode"
            >
              <Icon name="helpCircle" size={12} color={activeMode === 'general' ? '#ffffff' : '#0f766e'} />
              <span>General</span>
            </button>
          </div>
        </div>

        {/* Message Thread */}
        <div className="assistant-drawer-body" ref={bodyRef} onScroll={checkScroll}>
          {messages.map((msg, idx) => (
            <div
              key={msg.id}
              ref={idx === messages.length - 1 ? latestMsgRef : null}
              className={`assistant-msg-bubble ${
                msg.sender === 'user' ? 'msg-user' : 'msg-assistant'
              } ${msg.isError ? 'msg-error' : ''}`}
            >
              <div className="msg-header">
                <div className="msg-header-left">
                  <span className="msg-author">
                    {msg.sender === 'user' ? 'You' : 'MechGuard Copilot'}
                  </span>
                  {msg.sender === 'assistant' && msg.mode && (
                    <span className={`msg-mode-pill mode-${msg.mode}`}>
                      {msg.mode === 'factory' && 'Factory Record'}
                      {msg.mode === 'general' && 'General Guidance'}
                      {msg.mode === 'combined' && 'Factory Data + Guidance'}
                      {msg.mode === 'general_unavailable' && 'Local Records Mode'}
                    </span>
                  )}
                </div>
                <span className="msg-time">{msg.timestamp}</span>
              </div>

              {/* General Guidance notice banner if applicable */}
              {msg.mode === 'general' && (
                <div className="general-guidance-notice">
                  <Icon name="info" size={13} color="#0284c7" />
                  <span>General engineering guidance · Not an inspection finding about your specific plant machinery.</span>
                </div>
              )}
              {msg.generalGuidance && (
                <div className="general-guidance-notice">
                  <Icon name="info" size={13} color="#0f766e" />
                  <span>{msg.generalGuidance}</span>
                </div>
              )}

              {/* Main Formatted Text Content */}
              <div className="msg-text-content">
                {renderMessageBody(msg.text)}
              </div>

              {/* Recorded Factory Facts Section */}
              {msg.facts && msg.facts.length > 0 && (
                <div className="msg-section-box facts-box">
                  <div className="msg-section-label">
                    <Icon name="database" size={12} color="#0f766e" />
                    <span>Verified Factory Records</span>
                  </div>
                  <ul className="msg-section-list">
                    {msg.facts.map((fact, fIdx) => (
                      <li key={fIdx}>{renderInlineMarkdown(fact)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Model Outputs Section */}
              {msg.modelOutputs && msg.modelOutputs.length > 0 && (
                <div className="msg-section-box model-box">
                  <div className="msg-section-label">
                    <Icon name="activity" size={12} color="#b45309" />
                    <span>Machine Learning Diagnostics</span>
                  </div>
                  <ul className="msg-section-list">
                    {msg.modelOutputs.map((out, oIdx) => (
                      <li key={oIdx}>{renderInlineMarkdown(out)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actionable Engineering Recommendations */}
              {msg.recommendations && msg.recommendations.length > 0 && (
                <div className="msg-section-box recs-box">
                  <div className="msg-section-label">
                    <Icon name="wrench" size={12} color="#2563eb" />
                    <span>Recommended Maintenance Procedures</span>
                  </div>
                  <ul className="msg-section-list">
                    {msg.recommendations.map((rec, rIdx) => (
                      <li key={rIdx}>{renderInlineMarkdown(rec)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Traceable Citations Links */}
              {msg.citations && msg.citations.length > 0 && (
                <div className="msg-citations-container">
                  <div className="msg-citations-label">Grounded Record References:</div>
                  <div className="msg-citations-list">
                    {msg.citations.map((cite, cIdx) => (
                      <button
                        key={cIdx}
                        type="button"
                        className="citation-pill-btn"
                        onClick={() => handleCitationClick(cite.url)}
                        title={`Navigate to ${cite.title || cite.label || 'record'}`}
                      >
                        <span className="citation-pill-type">
                          {cite.type === 'machine' && 'Machine'}
                          {cite.type === 'alert' && 'Alert'}
                          {cite.type === 'dataset' && 'Dataset'}
                          {cite.type === 'analysis_run' && 'Run'}
                          {cite.type === 'standard' && 'Standard'}
                        </span>
                        <span className="citation-pill-title">{cite.title || cite.label}</span>
                        <Icon name="arrowRight" size={11} color="var(--primary)" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Work Order Proposal Draft with Human Approval Boundary */}
              {msg.workOrderDraft && (
                <div className="msg-draft-container">
                  <div className="msg-draft-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                      <Icon name="wrench" size={14} color="#0f766e" />
                      <span className="msg-draft-title">Proposed Maintenance Work Order</span>
                    </div>
                    <span className="msg-draft-status">AI Proposal Draft</span>
                  </div>

                  <div className="msg-draft-details">
                    <div className="draft-row">
                      <span className="draft-label">Target Equipment:</span>
                      <span className="draft-value mono-code">{msg.workOrderDraft.machineCode}</span>
                    </div>
                    <div className="draft-row">
                      <span className="draft-label">Task Title:</span>
                      <span className="draft-value">{msg.workOrderDraft.title}</span>
                    </div>
                    <div className="draft-row">
                      <span className="draft-label">Priority:</span>
                      <span className={`draft-priority-pill priority-${msg.workOrderDraft.priority?.toLowerCase()}`}>
                        {msg.workOrderDraft.priority?.toUpperCase()}
                      </span>
                    </div>
                    <div className="draft-row">
                      <span className="draft-label">Description:</span>
                      <p className="draft-desc">{msg.workOrderDraft.description}</p>
                    </div>

                    {msg.workOrderDraft.checklist && msg.workOrderDraft.checklist.length > 0 && (
                      <div className="draft-checklist-section">
                        <span className="draft-label">5-Point Inspection Protocol:</span>
                        <ul className="draft-checklist">
                          {msg.workOrderDraft.checklist.map((item, ckIdx) => (
                            <li key={ckIdx}>
                              <span className="ck-bullet">□</span> {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Manager Approval Action Boundary */}
                  <div className="msg-draft-actions">
                    {approvedOrders[msg.id] ? (
                      <div className="draft-approved-notice">
                        <Icon name="check" size={14} color="#16a34a" />
                        <span>
                          Approved & Dispatched as Work Order <strong>{approvedOrders[msg.id].orderNumber}</strong>.
                        </span>
                      </div>
                    ) : isManager ? (
                      <div>
                        {approvalError && <div className="draft-error-alert">{approvalError}</div>}
                        <button
                          type="button"
                          className="draft-approve-btn"
                          onClick={() => handleApproveDraft(msg.id, msg.workOrderDraft)}
                          disabled={approvingDraftId === msg.id}
                        >
                          {approvingDraftId === msg.id ? (
                            'Authorizing...'
                          ) : (
                            <>
                              <Icon name="check" size={13} color="#ffffff" />
                              <span>Authorize & Create Work Order</span>
                            </>
                          )}
                        </button>
                      </div>
                    ) : (
                      <div className="draft-permission-notice">
                        <Icon name="info" size={13} color="#b45309" />
                        <span>Manager approval required to create factory work orders.</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="assistant-msg-bubble msg-assistant msg-thinking">
              <div className="thinking-indicator">
                <span className="dot dot-1" />
                <span className="dot dot-2" />
                <span className="dot dot-3" />
              </div>
              <span className="thinking-text">Querying factory records & computing grounded synthesis...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {canScrollDown && (
          <button
            type="button"
            className="copilot-scroll-indicator-btn"
            onClick={() => {
              if (bodyRef.current) {
                bodyRef.current.scrollBy({ top: 220, behavior: 'smooth' });
              }
            }}
            title="More content below"
            aria-label="Scroll down for more diagnostic points"
          >
            <span>More content below</span>
            <Icon name="arrowDown" size={12} color="#0f766e" />
          </button>
        )}

        {/* Dynamic Contextual Suggestions Strip */}
        <div className="try-asking-bar">
          <div className="try-asking-label">
            <Icon name="helpCircle" size={13} color="#0f766e" />
            <span>Contextual Suggestions</span>
            {currentMachineCode && <span className="suggestion-machine-tag">{currentMachineCode}</span>}
          </div>
          <div className="try-asking-chips-scroll">
            {dynamicSuggestions.map((q, qIdx) => (
              <button
                key={qIdx}
                type="button"
                className="try-asking-chip"
                onClick={() => handleSend(q.query, q.mode)}
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input Bar */}
        <div className="assistant-drawer-footer">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="assistant-input-form"
          >
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              placeholder={
                activeMode === 'general'
                  ? 'Ask an engineering question (e.g. ISO 10816 standards)...'
                  : activeMode === 'factory'
                  ? currentMachineCode
                    ? `Ask about ${currentMachineCode} or active alerts...`
                    : 'Ask about authorized plant equipment (e.g. GB-104)...'
                  : currentMachineCode
                  ? `Ask about ${currentMachineCode}, alerts, or maintenance...`
                  : 'Ask about machine condition, alerts, or shift briefings...'
              }
              className="assistant-text-input"
              disabled={isLoading}
              aria-label="Ask MechGuard Copilot"
            />
            <button
              type="submit"
              className="assistant-send-btn"
              disabled={isLoading || !inputValue.trim()}
              aria-label="Send question to MechGuard Copilot"
            >
              <Icon name="send" size={15} color="#ffffff" />
            </button>
          </form>
          <div className="assistant-footer-disclaimer">
            <span>
              Grounds operational queries in authorized records • General guidance labeled clearly • Manager approval required
            </span>
          </div>
        </div>

        {/* Corner Resize Handles (Desktop only) */}
        {!isMobile && !windowState.isMinimized && (
          <>
            <div
              className="copilot-resize-handle copilot-resize-se"
              onPointerDown={(e) => handleResizePointerDown(e, 'se')}
              title="Drag to resize window"
              aria-label="Resize window bottom-right"
            />
            <div
              className="copilot-resize-handle copilot-resize-sw"
              onPointerDown={(e) => handleResizePointerDown(e, 'sw')}
              title="Drag to resize window"
              aria-label="Resize window bottom-left"
            />
          </>
        )}
      </>
    );
  };

  // On Mobile: Render bottom sheet modal with backdrop
  if (isMobile) {
    return (
      <div
        className="assistant-drawer-backdrop"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="MechGuard Copilot Drawer"
      >
        <div className="assistant-drawer-panel" onClick={(e) => e.stopPropagation()}>
          <div className="mobile-sheet-drag-bar" aria-hidden="true">
            <div className="mobile-sheet-drag-pill" />
          </div>
          {renderWindowContent()}
        </div>
      </div>
    );
  }

  // On Desktop: Render unconstrained floating window without blocking backdrop
  return (
    <div
      className={`copilot-floating-window ${isDragging ? 'is-dragging' : ''} ${isResizing ? 'is-resizing' : ''} ${windowState.isMinimized ? 'is-minimized' : ''}`}
      style={{
        left: `${windowState.x}px`,
        top: `${windowState.y}px`,
        width: windowState.isMinimized ? '300px' : `${windowState.width}px`,
        height: windowState.isMinimized ? '48px' : `${windowState.height}px`
      }}
      role="dialog"
      aria-label="MechGuard Copilot Floating Window"
    >
      {renderWindowContent()}
    </div>
  );
}
