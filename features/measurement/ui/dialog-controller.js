/**
 * Handles dialog boxes and notifications
 */

import i18n from '../i18n.js';

class DialogController {
    constructor(uiManager) {
        this.uiManager = uiManager;
    }

    /**
     * Show confirmation dialog
     * @param {string} message - Message to display
     * @param {boolean} showCheckbox - Whether to show the "don't warn again" checkbox
     */
    showConfirmation(message, showCheckbox = true) {
        const confirmationDialog = document.getElementById('confirmationDialog');
        const confirmationMessage = document.getElementById('confirmationMessage');
        const confirmationCheckbox = document.getElementById('confirmationCheckbox');
        const doNotWarnAgain = document.getElementById('doNotWarnAgain');
        
        if (!confirmationDialog || !confirmationMessage) {
            console.error(i18n.t('error:dialogElementsNotFound') || 'Confirmation dialog elements not found in the DOM');
            return;
        }
        
        // Set confirmation message
        confirmationMessage.textContent = message;
        
        // Show/hide checkbox
        if (confirmationCheckbox) {
            confirmationCheckbox.style.display = showCheckbox ? 'block' : 'none';
        }
        
        if (doNotWarnAgain) {
            doNotWarnAgain.checked = false;
        }
        
        // Show dialog
        confirmationDialog.style.display = 'flex';
    }

    /**
     * Handle confirmation dialog response
     * @param {boolean} confirmed - Whether the action was confirmed
     */
    handleConfirmation(confirmed) {
        const confirmationDialog = document.getElementById('confirmationDialog');
        
        if (!confirmationDialog) {
            console.error(i18n.t('error:confirmationDialogNotFound') || 'Confirmation dialog element not found in the DOM');
            return;
        }
        
        confirmationDialog.style.display = 'none';

        const { pendingAction, pendingDeleteId, pendingDeleteType } = this.uiManager;
        this.uiManager.pendingAction = null;
        this.uiManager.pendingDeleteId = null;
        this.uiManager.pendingDeleteType = null;

        if (confirmed && pendingAction) {
            // Execute the pending action
            pendingAction();
        } else if (confirmed && pendingDeleteId !== null) {
            // Handle deletion
            if (pendingDeleteType === 'measurement') {
                this.uiManager.measurementDisplay.deleteMeasurement(pendingDeleteId);
            } else if (pendingDeleteType === 'point') {
                this.uiManager.measurementDisplay.deletePoint(pendingDeleteId);
            }
        }
    }

    /**
     * Show a notification dialog with just an OK button
     * @param {string} message - Message to display
     */
    showNotification(message) {
        const notificationDialog = document.getElementById('notificationDialog');
        const notificationMessage = document.getElementById('notificationMessage');
        
        if (!notificationDialog || !notificationMessage) {
            console.error(i18n.t('error:notificationDialogNotFound') || 'Notification dialog elements not found in the DOM');
            return;
        }
        
        // Set notification message
        notificationMessage.textContent = message;
        
        // Show dialog
        notificationDialog.style.display = 'flex';
    }

    /**
     * Close the notification dialog
     */
    closeNotification() {
        const notificationDialog = document.getElementById('notificationDialog');
        
        if (!notificationDialog) {
            console.error(i18n.t('error:notificationDialogNotFound') || 'Notification dialog element not found in the DOM');
            return;
        }
        
        notificationDialog.style.display = 'none';
    }
}

export default DialogController;
