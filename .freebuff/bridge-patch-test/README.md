# WhatsApp Bulk Sender from Excel (.xlsx / .xls)

A powerful Chrome / Chromium Manifest V3 browser extension to send personalized WhatsApp messages and optional images to contacts imported from Excel files.

---

## Key Features

1. **Excel File Import (.xlsx / .xls / .csv)**
   - Drag & drop or browse `.xlsx`, `.xls`, or `.csv` files.
   - **Only Phone column is mandatory**.
   - Name and other columns are completely optional.
   - Auto-detects column headers and allows manual mapping of the Phone column.
   - Auto-formats phone numbers and handles 10-digit local numbers with optional default country code (e.g. `91`).

2. **Normal & Personalized Message Modes**
   - **Normal Mode**: Send a common message to all recipients without needing any `Name` column or variables.
   - **Personalized Mode**: Use `{{ColumnName}}` tags (e.g., `Hello {{Name}}, your order {{OrderID}} is confirmed on {{Date}}.`) to dynamically insert values per recipient row.
   - **Variable Picker**: Clickable chips listing all detected Excel headers automatically insert variables at your current cursor location in the message editor.
   - **Variable Validation**: Real-time checking ensures that all `{{variables}}` in the template exist in the imported Excel file before starting. Missing or empty optional fields are handled gracefully without crashing.

3. **Image Attachment Support**
   - **Common Image**: Upload a single image file to send with every message.
   - **Excel-based Image**: Select an Excel column containing image URLs or paths.
   - Live thumbnail preview in the message composer and interactive WhatsApp bubble preview.

4. **Contacts Table & Filtering**
   - Preview imported contacts with individual status badges (`Ready`, `Invalid Phone`, `Duplicate`).
   - Select or deselect individual recipients or toggle all.

5. **Persistent Queue Engine & Pacing Controls**
   - Queue items store status (`Pending`, `Processing`, `Sent`, `Failed`, `Skipped`), attempts, sent timestamps, and detailed error logs.
   - Queue state persists in `chrome.storage.local` across extension popup reopens.
   - **Controls**: `[ Start Campaign ]`, `[ Pause ]`, `[ Resume ]`, `[ Stop ]`.
   - **Configurable Pacing**: Set conservative delays (3â€“60 seconds, default 10s) between message operations.
   - **Duplicate Protection**: Skip duplicate phone numbers within the file or across past send history.

6. **Safety, Privacy & Consent**
   - Requires explicit recipient authorization/consent confirmation before starting a campaign.
   - No harvesting of credentials, passwords, session tokens, or cookies. All spreadsheet data remains local on your device.

---

## Extension Structure

```
whatsapp-excel-extension/
â”œâ”€â”€ manifest.json            # Extension Manifest V3 configuration
â”œâ”€â”€ popup/
â”‚   â”œâ”€â”€ popup.html           # Main dashboard UI
â”‚   â”œâ”€â”€ popup.js             # UI Controller & Event Handlers
â”‚   â””â”€â”€ popup.css            # Dark glassmorphic design system
â”œâ”€â”€ background/
â”‚   â””â”€â”€ service-worker.js    # Persistent queue worker & pacing manager
â”œâ”€â”€ content/
â”‚   â””â”€â”€ whatsapp.js          # Injected content script for web.whatsapp.com
â”œâ”€â”€ lib/
â”‚   â”œâ”€â”€ xlsx.full.min.js     # SheetJS library for offline Excel parsing
â”‚   â”œâ”€â”€ excel-parser.js      # Parser for workbook sheets & headers
â”‚   â”œâ”€â”€ variable-engine.js   # Variable extraction & template replacement
â”‚   â”œâ”€â”€ validator.js         # Phone & template variable validator
â”‚   â”œâ”€â”€ queue.js             # Queue generator & metric calculator
â”‚   â””â”€â”€ storage.js           # Chrome local storage wrapper
â””â”€â”€ assets/
    â”œâ”€â”€ icon16.png
    â”œâ”€â”€ icon48.png
    â””â”€â”€ icon128.png
```

## ParthSeva Manager local integration

The optional Manager bridge runs in the Manifest V3 service worker in `background/manager-bridge.js`. It validates desktop commands and queues accepted messages through ParthSender's existing sender workflow; it does not replace message sending. Pairing uses a five-minute, one-time code that identifies the Manager's runtime-selected loopback WebSocket port. The extension stores only the resulting device ID, session token, and `127.0.0.1` WebSocket URL in `chrome.storage.local`; it does not retain the pairing code.

The bridge reconnects with exponential backoff, authenticates with the saved credential, sends PING/PONG keepalives, rejects malformed or duplicate queues, reports per-message and terminal status, and stops accepting new messages after STOP or a lost connection. The server is local-only; no public endpoint or Native Messaging host is used. Chrome 116 or later is required for reliable WebSocket keepalive in a Manifest V3 service worker. The `http://127.0.0.1/*` host permission is required for the local WebSocket.

See `docs/PARTHSENDER_WEBSOCKET_PROTOCOL.md` in the ParthSeva Manager repository for protocol details. A real WhatsApp sending test requires a logged-in account and a recipient authorized for the test.
---

## Installation Guide

1. Open **Google Chrome**, **Brave**, or any Chromium-based browser.
2. Navigate to `chrome://extensions/` in the address bar.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked**.
5. Select the `parthsender` directory (`whatsapp-excel-extension`).
6. Open [WhatsApp Web](https://web.whatsapp.com/) in a browser tab and log in with your WhatsApp account.
7. Click the extension icon in your browser toolbar to launch the dashboard.

---

## Example Excel Files

### Example 1: Minimal File (Only Phone)
| Phone |
|---|
| 919876543210 |
| 919812345678 |
| 919999999999 |

**Template:**
```
Hello, this is an important announcement. Please check details. Thank you.
```

### Example 2: Personalized File
| Phone | Name | OrderID | Date | Amount |
|---|---|---|---|---|
| 919876543210 | Rahul | ORD001 | 25 Sept | â‚¹500 |
| 919812345678 | Amit | ORD002 | 26 Sept | â‚¹750 |

**Template:**
```
Hello {{Name}},

Your order {{OrderID}} has been scheduled for {{Date}}.
Total Amount: {{Amount}}

Thank you!
```

---

## Important Notice on Pacing & High-Volume Messaging

Pacing delay is provided to maintain browser stability. However, pacing does not guarantee immunity from WhatsApp account restrictions. For legitimate high-volume or official transactional messaging, please integrate the **official WhatsApp Business Platform / Cloud API**.
