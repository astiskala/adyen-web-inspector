import {
  DEVTOOLS_PANEL_ICON_PATH,
  DEVTOOLS_PANEL_PAGE,
  DEVTOOLS_PANEL_TITLE,
} from '../shared/constants.js';

// DevTools page entry — creates the Inspector panel in Chrome DevTools
chrome.devtools.panels.create(
  DEVTOOLS_PANEL_TITLE,
  DEVTOOLS_PANEL_ICON_PATH,
  DEVTOOLS_PANEL_PAGE,
  () => {
    // panel created
  }
);
