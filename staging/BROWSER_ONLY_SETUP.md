# Browser-only setup — no Terminal, no clasp

This is the mobile/browser alternative to the clasp workflow in [the main staging guide](./README.md). It uses a pre-combined Apps Script source file, so you only need to paste one large .gs file and create four HTML files in the Apps Script editor.

**This route does not use the Apps Script API and does not ask you to grant third-party applications permission to manage all your script projects.** You will paste source directly into the brand-new STAGING project that you create.

## Files to import

Open each raw file link, select all, copy, then paste into the matching file in the new Apps Script editor:

- [Combined Code.gs — all 18 .gs source files](https://raw.githubusercontent.com/rattasart153-ops/nobigaming/staging-runtime-test-kit/staging/browser-import/Code.gs)
- [Admin.html](https://raw.githubusercontent.com/rattasart153-ops/nobigaming/staging-runtime-test-kit/staging/browser-import/Admin.html)
- [Member.html](https://raw.githubusercontent.com/rattasart153-ops/nobigaming/staging-runtime-test-kit/staging/browser-import/Member.html)
- [QrCode.html](https://raw.githubusercontent.com/rattasart153-ops/nobigaming/staging-runtime-test-kit/staging/browser-import/QrCode.html)
- [Storefront.html](https://raw.githubusercontent.com/rattasart153-ops/nobigaming/staging-runtime-test-kit/staging/browser-import/Storefront.html)
- [appsscript.json manifest](https://raw.githubusercontent.com/rattasart153-ops/nobigaming/staging-runtime-test-kit/staging/browser-import/appsscript.json)

The combined Code.gs is approximately 154 KB. If your mobile browser cannot select/copy the full file reliably, do not paste a partial file; use a computer or tell me where the copy operation fails.

## Steps

### 1. Prepare Google resources first

Follow Part A of [the main staging guide](./README.md):
- Create a new blank spreadsheet named `Nobi Gaming STAGING DB`.
- Create two new Restricted Drive folders: `Nobi Gaming STAGING — Slips` and `Nobi Gaming STAGING — Media`.
- Keep all three resources private and separate from production.

### 2. Create a new standalone Apps Script project

1. In your mobile browser, open https://script.google.com/home.
2. If the editor does not display correctly, use the browser menu and choose **Desktop site**.
3. Create **New project**, name it `Nobi Gaming STAGING`.
4. Confirm this is a new project, not any existing production script.
5. In the editor, open **Project Settings** and enable **Show “appsscript.json” manifest file in editor**.

### 3. Replace the default Code.gs

1. Open the default `Code.gs`.
2. Select all its starter content and replace it with the complete contents of the Combined Code.gs link above.
3. Save the project.
4. Do not create separate .gs files for the source files already combined into this bundle.

### 4. Add the four HTML files

For each item, use the plus (+) next to Files → **HTML**, and create a file with the name shown (without the .html suffix):

- `Admin`
- `Member`
- `QrCode`
- `Storefront`

Open the matching raw link above, copy the complete content, paste into the corresponding HTML file, and save.

### 5. Set the manifest

Open `appsscript.json` in the Apps Script editor and replace its content with the manifest link above. It sets Bangkok timezone, V8 runtime, and Stackdriver exception logging.

### 6. Verify the file list before running anything

You should see exactly:
- `Code.gs`
- `Admin.html`
- `Member.html`
- `QrCode.html`
- `Storefront.html`
- `appsscript.json`

The Code.gs bundle includes all 18 server-side .gs files. Do not also add the original individual .gs files; that would duplicate declarations.

### 7. Continue with configuration and initialization

Return to Part C of [the main staging guide](./README.md) and follow it exactly:
1. Add only the new STAGING Script Properties.
2. Run `setupNobiDatabase`.
3. Confirm Schema v4 and 18 sheets.
4. Run `seedDefaultCatalog`.
5. Run `initializeAdmin`.
6. Only after all steps succeed, follow Part E to create a new web-app deployment with access **Only myself**.

Do not deploy before initialization succeeds. Do not choose Anyone or share the deployment URL publicly.

## Mobile copy/paste tips

- Open the raw link in a separate tab.
- Use Select all → Copy from the browser menu, not a partial text selection.
- Return to Apps Script, long-press inside the editor, Select all, Paste.
- Save after each file.
- If the browser reloads or the editor loses your clipboard, stop and verify the file contents before continuing.
- Do not send screenshots containing Script IDs, spreadsheet IDs, folder IDs, or credentials. If you need help, describe the screen and redact private IDs.

## Safety note

This method only writes code into the new STAGING Apps Script project that you created. It does not modify the GitHub source branch, `main`, or any existing Apps Script project. The source files are publicly readable from this repository, but all Script Properties and Google data resources remain private to your account.
