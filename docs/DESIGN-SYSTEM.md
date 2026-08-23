# Design System — Overview

**Product:** OpenRouter chat client · **Owner:** Stiger · **v1.0**

> Token and component names refer to Chakra UI v3. Verify against the pinned
> version before implementation.

---

## 1. Foundation

Chakra UI's default theme, used unmodified. No custom theme is maintained.

The design work is not inventing values — it is **constraining which inherited
values are used, and defining the states every surface must handle.**

---

## 2. Tokens in use

Components reference semantic tokens only. Raw palette scales and colour
literals are not used.

| Category  | Permitted                                                        |
| --------- | ---------------------------------------------------------------- |
| Surface   | `bg`, `bg.subtle`, `bg.muted`                                    |
| Text      | `fg`, `fg.muted`, `fg.error`                                     |
| Border    | `border`                                                         |
| Accent    | `colorPalette.solid`, `colorPalette.contrast`, `colorPalette.fg` |
| Spacing   | Scale steps `1`–`8`                                              |
| Type size | `xs`, `sm`, `md`, `lg`, `xl`                                     |
| Radius    | `md` (controls), `lg` (bubbles), `full` (chips)                  |

**Status colours** are set via `colorPalette`: accent = in progress,
`green` = complete, `orange` = rate limited, `red` = failed, `gray` = stopped.

---

## 3. Layout

```
┌──────────────┬────────────────────────────┐
│ [ New chat ] │  Transcript (scrolls)      │
│ ──────────   │                            │
│ Chat row     │    assistant bubble        │
│ Chat row     │           user bubble      │
│ Chat row     │  ┌──────────────────────┐  │
│              │  │ Composer             │  │
└──────────────┴──┴──────────────────────┴──┘
```

Chat list is fixed width and scrolls independently. Below `md` it becomes a
drawer. Transcript content is capped at a comfortable reading measure and
centred. Composer is pinned to the bottom.

---

## 4. Components

### New chat button

Primary action, top of the chat list. Always visible, always enabled.

### ChatListItem

Title (one line, truncated) · preview (`fg.muted`) · relative timestamp.

| State     | Treatment                          |
| --------- | ---------------------------------- |
| Default   | Transparent                        |
| Hover     | `bg.muted`                         |
| Selected  | `bg.muted` + accent edge indicator |
| Streaming | Accent dot before title            |
| Renaming  | Inline field replaces title        |

Rows are links, not buttons — chats are addressable URLs.

### MessageBubble

| Variant   | Treatment                                                         |
| --------- | ----------------------------------------------------------------- |
| User      | Right-aligned, `colorPalette.solid`, `colorPalette.contrast` text |
| Assistant | Left-aligned, `bg.subtle`, `1px` border                           |

Max width ~75% of the transcript. Whitespace preserved, long strings wrap.

### Composer

Auto-growing text area, capped height then scrolls.
Enter sends · Shift+Enter newline · Escape stops.
**Send** becomes **Stop** while streaming.

---

## 5. Required states

Every async surface handles all six. This is the review checklist.

| State       | Visual                                               | Announce     |
| ----------- | ---------------------------------------------------- | ------------ |
| Empty       | Muted headline + one action                          | —            |
| Loading     | Spinner with label, before first token               | Polite       |
| Streaming   | Caret at text end, composer disabled, Stop shown     | Polite, once |
| Complete    | Caret removed, actions revealed                      | —            |
| Interrupted | Partial text kept, "Stopped." in `fg.muted`          | Polite       |
| Failed      | Partial text kept, error in `fg.error`, retry inline | Assertive    |

Partial content is never discarded. A disabled control always states why.

---

## 6. Rules

| #   | Rule                                                             |
| --- | ---------------------------------------------------------------- |
| R1  | Semantic tokens only — no colour literals, no raw palette scales |
| R2  | No pixel values outside the spacing and size scales              |
| R3  | Chakra's theme is not extended or overridden                     |
| R4  | Every interactive element keeps a visible focus indicator        |
| R5  | Colour is never the only signal for a state                      |
| R6  | Streaming text is never animated                                 |

R1, R2 and R4 are enforced by lint. R3 requires an ADR to change.

---

## 7. Content

Sentence case. Buttons name the action ("Send", not "Submit"). Errors state
what happened and what to do — no "Oops", no apology. Empty states are an
invitation plus one action.

---

## 8. Accessibility

Target WCAG 2.1 AA.

- Streaming content sits in a polite live region **only while streaming**.
- Full keyboard path: new chat → select → compose → send → stop.
- Contrast and focus verified by automated audit in CI.
- `prefers-reduced-motion` honoured; the caret stops blinking.
