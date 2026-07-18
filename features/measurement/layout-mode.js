// Bootstrap the shared layout mode manager for the measurement page.
// Electron always keeps the desktop layout; this page exposes
// window.electronAPI (not electronIntegration), so guard explicitly.
import { LayoutModeManager } from '../../js/ui/layout-mode-manager.js';

if (!window.electronAPI) {
    new LayoutModeManager();
}
