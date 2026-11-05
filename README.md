# Thinkific Field Modifier — Chrome Extension

## Installation (sideloading)

1. Download and unzip this file
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `thinkific-extension` folder
6. The **T** icon will appear in your toolbar

> **Tip:** Pin the extension to your toolbar for easy access.

## How to use

### Scan a page automatically
1. Navigate to your Thinkific sign-up page (e.g. `courses.yoursite.com/users/sign_up`)
2. Click the **T** extension icon in your toolbar
3. Click **Scan page & open editor**
4. The editor opens in a new tab with field count and labels pre-filled

### Open blank editor
Click the extension icon → **Open editor (blank)** to start from scratch.

### Configure fields
In the editor's **Fields** tab:
- **Input type** — Text, Date picker, Dropdown, Dropdown (search), or Checkbox (mutually exclusive)
- **Dropdown options** — enter one option per line (used by both Dropdown and Dropdown (search))
- **Dropdown (search)** — renders a searchable text box with autocomplete (via a `<datalist>`) instead of a plain `<select>`. Typed text is matched against the option list (exact match first, then a "starts with" partial match); values that don't match are rejected with a customizable inline error message. Works as a master field for Field visibility and Dependent options rules, but can't currently be used as the *target* of a Dependent options rule.
- **Checkbox** — since Thinkific custom fields only store text, this renders a real `<input type="checkbox">` and writes one of two text values into the underlying field: a "checked" value (default `Yes`) when ticked, and an "unchecked" value (default `No`) when not — both editable per field. **Required** on a checkbox means it must be *checked* to proceed (e.g. a terms-of-service agreement), with a customizable error message. Works as a master field for Field visibility and Dependent options rules, but — like Dropdown (search) — can't be used as the *target* of a Dependent options rule.
- **Hide** — click to cycle: off → Sign up → Account → Always → off
- **Read only** — click to cycle: off → Sign up → Account → Always → off
- **Required** — click to cycle: off → Sign up → Account → Always → off
- **Prefill from URL parameter** — enter a query-string key (e.g. `ref` for `?ref=partner123`) and the field is filled from it on page load. Only fills a field that's currently empty — it never overwrites an existing saved value on the Account page. Works even on fields set to **Hide**, since hiding only affects the wrapper's CSS display, not whether the underlying input submits. For Dropdown, Dropdown (search), and Checkbox, the URL value must exactly match one of the field's configured options/values (case-insensitive); a non-matching value is silently ignored rather than shown as an error.

Chips with a dashed border are set to "Always".

### Conditionals
In the **Conditionals** tab:
- **Field visibility** — master dropdown shows/hides other fields based on its selected value
- **Dependent options** — selecting a value in one dropdown filters the options shown in another

### Pages (multi-step wizard)
In the **Pages** tab you can optionally break your **custom fields** into a multi-step wizard — a progress bar plus Back/Continue navigation, shown one step at a time. Off by default.
- Toggle **Enable multi-step layout**, then choose which pages it's active on: **Sign up** and/or **After checkout**. It is never available on the Account page.
- Add/rename/reorder steps, then assign each custom field to a step.
- **Page 1 is always reserved for the built-in fields** and isn't something you configure — the steps you build in this tab start at Page 2. On **Sign up**, Page 1 holds Name / Email / Password, and the "I agree to the Terms of Use" checkbox is automatically pinned to the last page. On **After checkout**, Page 1 holds Password.
- Required-field validation and any Field visibility / Dependent options conditionals still apply per-step; a step's "Continue" button is blocked until that step's required fields (and, on Page 1, the built-in fields) are filled.

### Export / Import
- **Export** — saves your full configuration as a named `.json` file you can re-open later
- **Import** — loads a previously exported file to resume editing

### Generated code
Switch to the **Generated code** tab, copy the script, and paste it before `</body>` in your Thinkific `theme.liquid` file.

## Pages the generated code supports
- `/users/sign_up` — signup form
- `/account/complete_signup` — profile completion (treated as part of sign-up flow)
- `/account` — edit profile page (existing values are restored correctly)
