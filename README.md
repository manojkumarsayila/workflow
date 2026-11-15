# TASKFLOW

A modern, responsive productivity app built with HTML5, CSS3 and vanilla JavaScript. No framework, no build step, no backend. Your data is saved in your browser's localStorage, so it survives refreshes.

## Features

- **Dashboard**: welcome banner, live date and time, total / completed / pending / overdue stats, completion donut chart, 7-day productivity chart, recent tasks and upcoming deadlines.
- **My Tasks**: add, edit, delete, complete, deadlines, priorities (Low / Medium / High), descriptions, categories, search, filters by status / priority / category, and sorting.
- **Completed Tasks**: review finished work, filter it, or clear it in one step.
- **Calendar**: monthly grid, tasks shown on their deadlines, month navigation, today highlighted, click a day to schedule a task.
- **Categories**: create, rename, recolor and delete categories, with per-category progress.
- **Settings**: display name, dark mode, default priority, delete confirmation, JSON backup export and import, restore samples, clear all data.
- **UX**: modal forms, confirmation before deletion, toast notifications, empty-state illustrations, responsive mobile navigation, smooth transitions, and keyboard shortcuts (`/` to search, `Esc` to close dialogs).

## Project structure

```
taskflow/
├── index.html   # Markup for every page, modal and the sidebar
├── style.css    # Design tokens (light and dark), layout, components, responsive rules
├── script.js    # App logic: data model, rendering, routing, storage
└── README.md
```

External libraries are loaded from CDNs: Google Fonts (Inter, Plus Jakarta Sans), Chart.js and Lucide icons. An internet connection is needed for them to load.

## Run locally

Option 1: open `index.html` in a browser.

Option 2 (recommended, avoids any browser quirks):

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then visit the address shown in the terminal (for example `http://localhost:8000`).

On first launch, TASKFLOW fills in realistic sample tasks so you can explore right away. Use **Settings → Restore sample tasks** at any time to get them back.

## Deploy

### Vercel

1. Push this folder to a GitHub repository.
2. On [vercel.com](https://vercel.com), click **Add New → Project** and import the repository.
3. Framework preset: **Other**. Build command and output directory: leave empty.
4. Click **Deploy**.

### GitHub Pages

1. Push the files to the root of a repository (or to a `docs/` folder).
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and the `/ (root)` folder, then save.
4. Your site will be live at `https://<username>.github.io/<repo>/`.

## Data and privacy

Everything stays in your browser. Tasks, categories and settings are stored in localStorage under keys starting with `taskflow.`. Use **Settings → Export backup** to save a JSON copy. Clearing your browser data will remove TASKFLOW's data.

## Customize

- **Colors and theme**: edit the tokens at the top of `style.css`.
- **Categories and sample data**: edit `DEFAULT_CATEGORIES` and `buildSampleTasks()` in `script.js`.
- **Priorities and sort options**: edit `PRIORITIES` and `SORT_OPTIONS` in `script.js`.
