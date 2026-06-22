/**
 * EventManager - Handles event listeners and user activity detection
 */
export class EventManager {
    /**
     * Create a new EventManager instance
     * @param {Object} audioManager - Reference to the main AudioManager
     */
    constructor(audioManager) {
        this.audioManager = audioManager;
        
        // Event listeners for audio state changes
        this.eventListeners = {
            sleepModeChanged: []
        };
        
        // Setup user activity detection
        this.setupUserActivityDetection();
    }
    
    /**
     * Set up event listeners for user activity detection
     */
    setupUserActivityDetection() {
        // Detect user activity events
        const userActivityEvents = [
            'mousedown', 'mouseup', 'mousemove',
            'keydown', 'keyup',
            'touchstart', 'touchend', 'touchmove',
            'click', 'dblclick', 'wheel'
        ];
        
        // Add event listeners for all user activity events
        userActivityEvents.forEach(eventType => {
            document.addEventListener(eventType, this.handleUserActivity.bind(this), { passive: true });
        });
    }
    
    /**
     * Handle user activity events
     */
    handleUserActivity() {
        // Notify audio processor about user activity
        if (this.audioManager.workletNode) {
            this.audioManager.workletNode.port.postMessage({
                type: 'userActivity'
            });
        }
    }
    
    /**
     * Add an event listener
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Callback function
     */
    addEventListener(eventName, callback) {
        if (!this.eventListeners[eventName]) {
            this.eventListeners[eventName] = [];
        }
        this.eventListeners[eventName].push(callback);
    }
    
    /**
     * Remove an event listener
     * @param {string} eventName - Name of the event
     * @param {Function} callback - Callback function to remove
     */
    removeEventListener(eventName, callback) {
        if (this.eventListeners[eventName]) {
            this.eventListeners[eventName] = this.eventListeners[eventName].filter(
                listener => listener !== callback
            );
        }
    }
    
    /**
     * Dispatch an event to all registered listeners
     * @param {string} eventName - Name of the event
     * @param {Object} data - Event data
     */
    dispatchEvent(eventName, data) {
        if (this.eventListeners[eventName]) {
            for (const listener of this.eventListeners[eventName]) {
                listener(data);
            }
        }
    }
}
