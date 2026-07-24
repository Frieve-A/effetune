/**
 * Internationalization utilities for EffeTune Measurement feature
 */

// Default language is English
let currentLanguage = 'en';
// Cache for loaded translations
let baseTranslations = null; // English translations (fallback)
let currentTranslations = null; // Current language translations

/**
 * Load the English base translations
 * @returns {Promise<Object>} The loaded translations
 */
async function loadBaseTranslations() {
  try {
    // Fetch the English translation file
    const response = await fetch('locales/en.json5');
    if (!response.ok) {
      console.error('Failed to load base English translations');
      return {};
    }
    
    const text = await response.text();
    // Process JSON5 (remove comments and parse)
    const jsonText = text.replace(/\/\/.*$/gm, ''); // Remove single line comments
    baseTranslations = JSON.parse(jsonText);
    return baseTranslations;
  } catch (error) {
    console.error('Error loading base translations:', error);
    return {};
  }
}

/**
 * Load translations for the current language
 * @returns {Promise<Object>} The loaded translations
 */
async function loadCurrentTranslations() {
  // If current language is English, use base translations
  if (currentLanguage === 'en') {
    currentTranslations = baseTranslations;
    return currentTranslations;
  }
  
  try {
    // Fetch the translation file based on the current language
    const response = await fetch(`locales/${currentLanguage}.json5`);
    if (!response.ok) {
      console.warn(`No translations found for ${currentLanguage}, using English as fallback`);
      currentTranslations = {}; // Empty object, will fallback to base
      return currentTranslations;
    }
    
    const text = await response.text();
    // Process JSON5 (remove comments and parse)
    const jsonText = text.replace(/\/\/.*$/gm, ''); // Remove single line comments
    currentTranslations = JSON.parse(jsonText);
    return currentTranslations;
  } catch (error) {
    console.warn(`Error loading translations for ${currentLanguage}, using English as fallback:`, error);
    currentTranslations = {}; // Empty object, will fallback to base
    return currentTranslations;
  }
}

/**
 * Set the current language
 * @param {string} lang - Language code (e.g., 'en', 'ja')
 */
export async function setLanguage(lang) {
  if (lang === currentLanguage) {
    return; // No change needed
  }
  
  currentLanguage = lang;
  // Load new language translations
  await loadCurrentTranslations();
  // Refresh the UI with new language
  return translateUI();
}

/**
 * Check if a translation ID exists in either current language or English
 * @param {string} id - Translation ID
 * @returns {boolean} Whether the ID exists
 */
export function hasTranslation(id) {
  return (currentTranslations && currentTranslations[id]) || 
         (baseTranslations && baseTranslations[id]);
}

/**
 * Get a translated text by ID
 * @param {string} id - Translation ID
 * @returns {string|null} Translated text or null if translation not found
 */
export function t(id, params = {}) {
  let translation = null;
  // First check if ID exists in current language
  if (currentTranslations && currentTranslations[id]) {
    translation = currentTranslations[id];
  }
  
  // Fallback to English
  if (translation === null && baseTranslations && baseTranslations[id]) {
    translation = baseTranslations[id];
  }

  // Return null if no translation found
  // This signals to keep the original text
  if (translation === null) return null;
  return Object.entries(params).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    translation
  );
}

/**
 * Legacy async version of the translation function for compatibility
 * @param {string} id - Translation ID
 * @returns {Promise<string|null>} Translated text or null if translation not found
 */
export async function tAsync(id, params = {}) {
  return t(id, params);
}

/**
 * Translate all UI elements that have a data-i18n attribute
 */
export async function translateUI() {
  const elements = document.querySelectorAll('[data-i18n]');
  for (const element of elements) {
    const id = element.getAttribute('data-i18n');
    const translation = t(id);
    
    // Only update text if a translation was found
    if (translation !== null) {
      // Handle different element types
      if (element.tagName === 'INPUT' && element.hasAttribute('placeholder')) {
        element.placeholder = translation;
      } else if (element instanceof HTMLElement) {
        element.textContent = translation;
      }
    }
  }
}

/**
 * Initialize translations on page load
 */
export async function initI18n() {
  // First load English as base translations
  await loadBaseTranslations();
  
  // Detect browser language or use stored preference
  const browserLang = navigator.language.split('-')[0];
  const storedLang = localStorage.getItem('effetune-language');
  
  // Set language (default to 'en' if browser language or stored preference not available)
  currentLanguage = storedLang || browserLang || 'en';
  
  // Load translations for current language
  await loadCurrentTranslations();
  
  // Update UI
  await translateUI();
}

export default {
  t,
  tAsync,
  hasTranslation,
  setLanguage,
  translateUI,
  initI18n
};
