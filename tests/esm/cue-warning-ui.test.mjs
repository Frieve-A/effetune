import assert from 'node:assert/strict';
import test from 'node:test';

import { LibraryView } from '../../js/ui/library/library-view.js';

test('CUE scan warnings are coalesced into one actionable non-error notification per scan', () => {
  const notifications = [];
  const live = { textContent: '' };
  const view = Object.create(LibraryView.prototype);
  view.lastCueWarningNotificationScanId = null;
  view.content = { querySelector: selector => selector === '.library-paged-live' ? live : null };
  view.uiManager = {
    t(key, params = {}) {
      const messages = {
        'library.paged.cueScanWarningSummary': `Summary ${params.count}.`,
        'library.paged.cueScanWarningInvalid': `Invalid ${params.count}.`,
        'library.paged.cueScanWarningUnsupported': `Unsupported ${params.count}.`,
        'library.paged.cueScanWarningTooLarge': `Large ${params.count}.`,
        'library.paged.cueScanWarningAction': 'Fix the sheets and rescan.'
      };
      return messages[key] ?? key;
    },
    setError(message, sticky) {
      notifications.push({ message, sticky });
    }
  };
  const state = {
    scanId: 'scan-warning',
    phase: 'done',
    warnings: [
      { category: 'cue-invalid', count: 2 },
      { category: 'cue-unsupported', count: 1 },
      { category: 'cue-too-large', count: 3 }
    ]
  };

  view.reportCueScanWarnings(state);
  view.reportCueScanWarnings(state);

  const message = 'Summary 6. Invalid 2. Unsupported 1. Large 3. Fix the sheets and rescan.';
  assert.deepEqual(notifications, [{ message, sticky: false }]);
  assert.equal(live.textContent, message);
});
