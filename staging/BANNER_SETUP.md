# Nobi Gaming — Banner Carousel (STAGING)

This feature replaces the old hard-coded hero slides with a responsive image carousel controlled by the **banners** tab in the STAGING Google Spreadsheet.

**Scope:** staging-runtime-test-kit only. Do not use Production IDs, files, or deployments.

## How it works

- Storefront reads active rows from the banners sheet through the Apps Script browser facade.
- Slides are ordered by sort_order (smallest first).
- The carousel advances every 6 seconds, pauses while hovered/focused, and supports dots, arrows, and touch swipe.
- It displays only banners whose active flag is TRUE and whose optional start/end dates include the current time.
- Changing sheet values does not require a new deployment. Code changes do.

## Upgrade the existing STAGING project

Do not create another project or spreadsheet. Do not rerun catalog seeding or Admin initialization.

1. In the existing **Nobi Gaming STAGING** Apps Script project, replace the complete contents of Code.gs with the latest [combined Code.gs](https://raw.githubusercontent.com/rattasart153-ops/nobigaming/staging-runtime-test-kit/staging/browser-import/Code.gs).
2. Replace the complete contents of Storefront.html with the latest [Storefront.html](https://raw.githubusercontent.com/rattasart153-ops/nobigaming/staging-runtime-test-kit/staging/browser-import/Storefront.html).
3. Save both files.
4. Run **setupNobiDatabase** once from the Apps Script editor and approve the requested access if Google asks.
   - Existing Schema v4 is upgraded non-destructively to Schema v5.
   - The setup creates a new **banners** tab; existing tabs and rows are retained.
   - Expected result: schemaVersion: 5, sheetCount: 19.
5. Open the STAGING spreadsheet and confirm the new **banners** tab exists.
6. Add at least one active banner row using the columns below.
7. Deploy a **new version of the existing STAGING Web App deployment**. Keep Execute as **Me** and access **Only myself**.
8. Open the STAGING Storefront and test the carousel. Do not update or deploy Production.

If setup reports an incompatible schema or anything other than Schema v5, stop and report the exact message. Do not delete, rename, or manually rewrite existing tabs.

## banners sheet columns

The header row is created automatically by setupNobiDatabase. Keep the column names and order unchanged.

| Column | Required? | What to enter |
|---|---:|---|
| **banner_id** | Yes | Unique text ID, e.g. banner-001 |
| **title** | No | Optional short title overlay on the image |
| **subtitle** | No | Optional subtitle overlay |
| **image_file_id** | One image source required | Google Drive file ID from a file uploaded into the private STAGING Media folder |
| **image_url** | Alternative | Direct HTTPS image URL from a host that permits embedding; leave blank when using image_file_id |
| **link_url** | No | Destination when the image is tapped, e.g. #games or an HTTPS URL |
| **active** | Yes | TRUE to show, FALSE to hide |
| **sort_order** | Yes | Number; 1 appears first, then 2, 3, etc. |
| **starts_at** | No | Start date/time; leave blank for immediate availability |
| **ends_at** | No | End date/time; leave blank for no end date |
| **created_at** | No | Leave blank when creating rows manually |
| **updated_at** | No | Leave blank when creating rows manually |

Example row:

| banner_id | title | subtitle | image_file_id | image_url | link_url | active | sort_order | starts_at | ends_at |
|---|---|---|---|---|---|---|---:|---|---|
| banner-001 | โปรโมชันประจำเดือน | เติมเกมคุ้มกว่าเดิม | PASTE_DRIVE_FILE_ID | | #games | TRUE | 1 | | |

## Recommended image workflow

1. Design your banner image yourself. Recommended canvas: **1920 × 720 px** (wide landscape); keep important text/logos away from the extreme edges so it crops well on phones.
2. Export as JPG, PNG, or WebP. Keep the file reasonably compressed (recommended 3 MB or less).
3. Upload it to the existing **Nobi Gaming STAGING — Media** Drive folder.
4. Keep the folder and file **Restricted / private**. Do not enable link sharing.
5. Open the uploaded file in Drive and copy only its file ID (the segment between /d/ and /view in the file URL) into image_file_id.
6. Set active to TRUE and sort_order to the desired order.

The Storefront retrieves a private Drive image through the Apps Script media facade only when an active banner row references it. Do not paste a Google Drive sharing URL into image_url. If using an external image host instead, put its direct HTTPS image URL in image_url and leave image_file_id blank.

## Day-to-day management

- Add a row to add a banner.
- Change sort_order to reorder banners.
- Set active to FALSE to hide one without deleting its history.
- Edit starts_at / ends_at to schedule a campaign.
- Replace the file ID or image URL to change its image.
- These data changes take effect on the next Storefront load; no deployment is required.

The carousel is hidden automatically when there are no valid active banner rows. This avoids showing an empty hero area.
