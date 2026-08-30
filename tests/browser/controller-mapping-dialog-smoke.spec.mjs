import assert from 'node:assert/strict';

const FIXTURE_PATH = '/tests/browser/controller-mapping-dialog-smoke.fixture.html';

export async function runControllerMappingDialogBrowserSmoke({ browser, baseURL }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${baseURL}${FIXTURE_PATH}`, { waitUntil: 'load' });
    const result = await page.evaluate(() => window.__controllerMappingDialogSmoke.run());
    const typeSelect = page.locator('.midi-target-type-field > .config-select').first();
    await typeSelect.click();
    const dropdown = await page.evaluate(() => {
      const select = document.querySelector('.midi-target-type-field > .config-select');
      const list = document.querySelector('.standard-select-list:not([hidden])');
      const row = list?.querySelector('.standard-select-option');
      const listStyle = list ? getComputedStyle(list) : null;
      const rowStyle = row ? getComputedStyle(row) : null;
      const selectStyle = select ? getComputedStyle(select) : null;
      const trackStyle = list ? getComputedStyle(list, '::-webkit-scrollbar-track') : null;
      const thumbStyle = list ? getComputedStyle(list, '::-webkit-scrollbar-thumb') : null;
      const findMaxHeight = (rules, selector) => {
        for (const rule of rules) {
          if (rule.selectorText === selector) return rule.style.maxHeight;
          if (rule.cssRules) {
            const nested = findMaxHeight(rule.cssRules, selector);
            if (nested) return nested;
          }
        }
        return '';
      };
      const stylesheets = Array.from(document.styleSheets);
      return {
        open: Boolean(list),
        optionsMatchSelect: list?.children.length === select?.options.length,
        longOptionList: (list?.children.length || 0) > 20,
        scrollHeight: list?.scrollHeight || 0,
        clientHeight: list?.clientHeight || 0,
        maxHeight: Number.parseFloat(list?.style.maxHeight || '0'),
        scrollbarGutter: list ? Math.max(0, list.offsetWidth - list.clientWidth -
          Number.parseFloat(listStyle.borderLeftWidth) - Number.parseFloat(listStyle.borderRightWidth)) : 0,
        background: listStyle?.backgroundColor,
        border: listStyle?.borderTopColor,
        overflowY: listStyle?.overflowY,
        rowFontMatchesSelect: rowStyle?.font === selectStyle?.font,
        rowTextAlign: rowStyle?.textAlign,
        trackBackground: trackStyle?.backgroundImage,
        thumbBackground: thumbStyle?.backgroundImage,
        standardCssMaxHeight: stylesheets
          .map(sheet => findMaxHeight(sheet.cssRules, '.standard-select-list'))
          .find(Boolean),
        existingMenuCssMaxHeight: stylesheets
          .map(sheet => findMaxHeight(sheet.cssRules, 'body.layout-mobile .library-context-menu.library-action-sheet'))
          .find(Boolean),
        nativePopupOpen: select?.matches(':open') || false
      };
    });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const select = document.querySelector('.midi-target-type-field > .config-select');
      select.selectedIndex = select.options.length - 1;
      Object.assign(select.style, {
        position: 'fixed',
        right: '24px',
        bottom: '20px'
      });
    });
    await typeSelect.click();
    const selectedDropdown = await page.evaluate(() => {
      const select = document.querySelector('.midi-target-type-field > .config-select');
      const list = document.querySelector('.standard-select-list:not([hidden])');
      const selected = list?.querySelector('.standard-select-option[aria-selected="true"]');
      const selectRect = select?.getBoundingClientRect();
      const listRect = list?.getBoundingClientRect();
      return {
        selectedVisible: Boolean(selected) && selected.offsetTop >= list.scrollTop &&
          selected.offsetTop + selected.offsetHeight <= list.scrollTop + list.clientHeight,
        scrolledToSelected: (list?.scrollTop || 0) > 0,
        openedAbove: Boolean(selectRect && listRect) && listRect.bottom <= selectRect.top
      };
    });
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      const select = document.querySelector('.midi-target-type-field > .config-select');
      select.removeAttribute('style');
    });
    const mappingDropdownClosed = await page.locator('.standard-select-list:not([hidden])').count() === 0;
    const sourceSelect = page.locator('.midi-device-row .config-select').first();
    await sourceSelect.click();
    const sourceDropdown = await page.evaluate(() => {
      const list = document.querySelector('.standard-select-list:not([hidden])');
      const style = list ? getComputedStyle(list) : null;
      return {
        open: Boolean(list),
        options: list?.children.length || 0,
        scrollHeight: list?.scrollHeight || 0,
        clientHeight: list?.clientHeight || 0,
        scrollbarGutter: list ? Math.max(0, list.offsetWidth - list.clientWidth -
          Number.parseFloat(style.borderLeftWidth) - Number.parseFloat(style.borderRightWidth)) : 0
      };
    });
    await page.keyboard.press('Escape');
    const zoomedDropdowns = await page.evaluate(async () => {
      const select = document.querySelector('.midi-target-type-field > .config-select');
      const results = [];
      for (const zoom of ['0.3', '1', '3']) {
        document.body.style.zoom = zoom;
        select.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        await new Promise(resolve => requestAnimationFrame(resolve));
        const list = document.querySelector('.standard-select-list:not([hidden])');
        const bodyZoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
        const selectRect = select.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const viewportWidth = window.innerWidth / bodyZoom;
        const viewportHeight = window.innerHeight / bodyZoom;
        const margin = 8;
        const gap = 4;
        const rect = {
          left: selectRect.left / bodyZoom,
          right: selectRect.right / bodyZoom,
          top: selectRect.top / bodyZoom,
          bottom: selectRect.bottom / bodyZoom,
          width: selectRect.width / bodyZoom
        };
        const availableBelow = Math.max(0, viewportHeight - rect.bottom - gap - margin);
        const availableAbove = Math.max(0, rect.top - gap - margin);
        const verticalChrome = list.offsetHeight - list.clientHeight;
        const standardMaxHeight = Number.parseFloat(getComputedStyle(list).maxHeight);
        const desiredHeight = Math.min(
          list.scrollHeight + verticalChrome,
          standardMaxHeight,
          Math.max(0, viewportHeight - 40)
        );
        const openAbove = desiredHeight > availableBelow && availableAbove > availableBelow;
        const availableHeight = openAbove ? availableAbove : availableBelow;
        const width = Math.min(rect.width, Math.max(0, viewportWidth - margin * 2));
        const left = Math.min(Math.max(margin, rect.left), viewportWidth - margin - width);
        const top = openAbove
          ? Math.max(margin, rect.top - gap - Math.min(desiredHeight, availableHeight))
          : Math.max(margin, rect.bottom + gap);
        results.push({
          bodyZoom,
          expected: { left, top, width, maxHeight: Math.min(desiredHeight, availableHeight) },
          actual: {
            left: Number.parseFloat(list.style.left),
            top: Number.parseFloat(list.style.top),
            width: Number.parseFloat(list.style.width),
            maxHeight: Number.parseFloat(list.style.maxHeight),
            viewportContained: listRect.left >= -1 && listRect.top >= -1 &&
              listRect.right <= window.innerWidth + 1 && listRect.bottom <= window.innerHeight + 1,
            aligned: Math.abs(listRect.left - selectRect.left) <= 1 &&
              Math.abs(listRect.width - selectRect.width) <= 1
          }
        });
        select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      }
      document.body.style.zoom = '';
      return results;
    });
    await page.setViewportSize({ width: 1280, height: 1200 });
    const dynamicDropdowns = await page.evaluate(async () => {
      const select = document.querySelector('.midi-target-type-field > .config-select');
      const replaceOptions = count => {
        select.replaceChildren(...Array.from({ length: count }, (_, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = `Option ${index + 1}`;
          return option;
        }));
      };
      const openAndMeasure = async () => {
        select.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
        await new Promise(resolve => requestAnimationFrame(resolve));
        const list = document.querySelector('.standard-select-list:not([hidden])');
        const style = getComputedStyle(list);
        return {
          clientHeight: list.clientHeight,
          scrollHeight: list.scrollHeight,
          maxHeight: Number.parseFloat(list.style.maxHeight),
          scrollbarGutter: Math.max(0, list.offsetWidth - list.clientWidth -
            Number.parseFloat(style.borderLeftWidth) - Number.parseFloat(style.borderRightWidth)),
          selectedVisible: Boolean(list.querySelector('[aria-selected="true"]')) &&
            list.querySelector('[aria-selected="true"]').offsetTop >= list.scrollTop &&
            list.querySelector('[aria-selected="true"]').offsetTop +
              list.querySelector('[aria-selected="true"]').offsetHeight <= list.scrollTop + list.clientHeight
        };
      };

      replaceOptions(2);
      const few = await openAndMeasure();
      select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      replaceOptions(26);
      select.selectedIndex = select.options.length - 1;
      const many = await openAndMeasure();
      select.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { few, many };
    });
    const measureLayout = async ({ width, mobile = false }) => {
      await page.setViewportSize({ width, height: 900 });
      return page.evaluate(async useMobileLayout => {
        document.body.classList.toggle('layout-mobile', useMobileLayout);
        await new Promise(resolve => requestAnimationFrame(resolve));
        const dialog = document.querySelector('.midi-mapping-dialog');
        const content = dialog.querySelector('.midi-mapping-content');
        const row = dialog.querySelector('.midi-mapping-row');
        const target = row.querySelector('.midi-target-controls');
        const details = row.querySelector('.midi-map-details');
        const rowHead = row.querySelector('.midi-mapping-row-head');
        const actions = dialog.querySelector('.midi-mapping-header-actions');
        const header = dialog.querySelector(':scope > .library-properties-head');
        const footer = dialog.querySelector(':scope > .library-properties-head:last-child');
        const columnCount = element => getComputedStyle(element).gridTemplateColumns
          .split(/\s+/).filter(Boolean).length;
        const targetControlTops = Array.from(target.querySelectorAll('.midi-field > select'), control =>
          control.getBoundingClientRect().top
        );
        const headChildren = Array.from(rowHead.children, child => child.getBoundingClientRect());
        const headerTop = header.getBoundingClientRect().top;
        const footerTop = footer.getBoundingClientRect().top;
        content.scrollTop = Math.min(120, content.scrollHeight - content.clientHeight);
        await new Promise(resolve => requestAnimationFrame(resolve));
        return {
          dialogWidth: dialog.getBoundingClientRect().width,
          targetColumns: columnCount(target),
          detailColumns: columnCount(details),
          headerActionDisplay: getComputedStyle(actions).display,
          headerActionColumns: getComputedStyle(actions).display === 'grid' ? columnCount(actions) : 0,
          headerButtonsGrouped: actions.children.length === 2 &&
            Array.from(actions.children).every(child => child.matches('button')),
          targetAligned: targetControlTops.every(top => Math.abs(top - targetControlTops[0]) <= 1),
          sourceDeleteAligned: Math.abs(
            (headChildren[0].top + headChildren[0].bottom) / 2 -
            (headChildren[1].top + headChildren[1].bottom) / 2
          ) <= 1,
          controlsWithinFields: Array.from(row.querySelectorAll('select, input')).every(control =>
            control.parentElement?.matches('label.midi-field') &&
            control.getBoundingClientRect().width <= control.parentElement.getBoundingClientRect().width + 1
          ),
          noHorizontalOverflow: dialog.scrollWidth <= dialog.clientWidth + 1 &&
            content.scrollWidth <= content.clientWidth + 1 && row.scrollWidth <= row.clientWidth + 1,
          rowSeparated: getComputedStyle(row).borderBottomWidth === '1px',
          fixedChrome: header.getBoundingClientRect().top === headerTop &&
            footer.getBoundingClientRect().top === footerTop
        };
      }, mobile);
    };
    const desktopLayout = await measureLayout({ width: 1280 });
    const intermediateLayout = await measureLayout({ width: 700 });
    const mobileLayout = await measureLayout({ width: 480, mobile: true });
    await page.evaluate(() => document.body.classList.remove('layout-mobile'));
    await page.setViewportSize({ width: 1280, height: 1200 });
    await page.locator('.midi-mapping-dialog > .library-properties-head:last-child .library-button').click();
    const languageSelect = page.locator('#language-select');
    await languageSelect.click();
    const settingsDropdown = await page.evaluate(() => {
      const select = document.getElementById('language-select');
      const list = document.querySelector('.standard-select-list:not([hidden])');
      const style = list ? getComputedStyle(list) : null;
      return {
        open: Boolean(list),
        optionsMatch: list?.children.length === select?.options.length,
        scrollHeight: list?.scrollHeight || 0,
        clientHeight: list?.clientHeight || 0,
        scrollbarGutter: list ? Math.max(0, list.offsetWidth - list.clientWidth -
          Number.parseFloat(style.borderLeftWidth) - Number.parseFloat(style.borderRightWidth)) : 0,
        nativePopupOpen: select?.matches(':open') || false
      };
    });
    await page.keyboard.press('Escape');
    assert.deepEqual(result, {
      customStylesheet: false,
      standardDialog: true,
      dialog: true,
      learnActive: false,
      learnedBefore: 16,
      mappingCount: 18,
      renderedRows: 18,
      nativeTimerAutomation: {
        timerReservedBeforeTick: true,
        changedOnFirstTick: true,
        workletUpdates: 1,
        uiUpdates: 1,
        timerReservedAfterTick: true,
        historySaves: 1,
        feedbackStarted: true,
        feedbackStopped: true
      },
      automation: {
        timer: {
          added: true,
          addedImmediately: true,
          visibleAfterAdd: true,
          scrolledToEnd: true,
          deviceNameHidden: true,
          numericParametersOnly: true,
          intervalVisible: true,
          actionVisible: true,
          amountVisible: true,
          physicalControlsHidden: true
        },
        targetTypeChange: {
          renderedImmediately: true,
          options: ['frequency:0'],
          selected: 'frequency:0',
          target: {
            type: 'AlternatePlugin', instance: 'last', param: 'frequency', element: 0
          },
          range: { lo: 20, hi: 20000, amount: 10 }
        },
        parameterChange: {
          renderedImmediately: true,
          selected: 'frequency:0',
          target: {
            type: 'TestPlugin', instance: 'all', param: 'frequency', element: 0
          },
          range: { lo: 20, hi: 20000, amount: 10 }
        },
        schedules: {
          onceVisible: true,
          onceSummary: true,
          expiredVisible: true,
          futureRearmed: true,
          dailyVisible: true,
          dailySummary: true,
          intervalRestored: true
        },
        clock: {
          timePartVisible: true,
          waveVisible: true,
          intervalHidden: true,
          actionHidden: true,
          amountHidden: true
        }
      },
      realRange: { min: '-12', max: '12', step: '0.5', value: '-12' },
      separateActions: true,
      scroll: {
        body: true,
        dialog: 0,
        headerFixed: true,
        footerFixed: true,
        footerPadded: true
      },
      dropdown: {
        optionsComplete: true,
        longOptionList: true,
        settingsClass: true,
        standardSelectEnabled: true,
        computedStyleMatchesSettings: true,
        nativeAppearance: true,
        fontMatchesSettings: true,
        alignmentMatchesSettings: true,
        colorSchemeMatchesSettings: true,
        customPickerRule: false
      }
    });
    assert.deepEqual({
      ...dropdown,
      scrollHeight: 0,
      clientHeight: 0,
      maxHeight: 0,
      scrollbarGutter: 0
    }, {
      open: true,
      optionsMatchSelect: true,
      longOptionList: true,
      scrollHeight: 0,
      clientHeight: 0,
      maxHeight: 0,
      scrollbarGutter: 0,
      background: 'rgb(55, 55, 55)',
      border: 'rgb(86, 86, 86)',
      overflowY: 'auto',
      rowFontMatchesSelect: true,
      rowTextAlign: 'left',
      trackBackground: 'linear-gradient(rgb(41, 41, 41), rgb(35, 35, 35))',
      thumbBackground: 'linear-gradient(rgb(93, 98, 104), rgb(70, 75, 81))',
      standardCssMaxHeight: '480px',
      existingMenuCssMaxHeight: 'min(70vh, 480px)',
      nativePopupOpen: false
    });
    assert.equal(dropdown.maxHeight <= 480, true);
    assert.equal(dropdown.clientHeight <= dropdown.maxHeight, true);
    assert.equal(dropdown.scrollHeight > dropdown.clientHeight, true);
    assert.equal(mappingDropdownClosed, true);
    assert.deepEqual(selectedDropdown, {
      selectedVisible: true,
      scrolledToSelected: true,
      openedAbove: true
    });
    assert.equal(sourceDropdown.open, true);
    assert.equal(sourceDropdown.options, 2);
    assert.equal(sourceDropdown.scrollHeight, sourceDropdown.clientHeight);
    assert.equal(sourceDropdown.scrollbarGutter, 0);
    assert.equal(dynamicDropdowns.few.clientHeight, dynamicDropdowns.few.scrollHeight);
    assert.equal(dynamicDropdowns.few.scrollbarGutter, 0);
    assert.equal(dynamicDropdowns.many.maxHeight, 480);
    assert.equal(dynamicDropdowns.many.clientHeight <= 480, true);
    assert.equal(dynamicDropdowns.many.scrollHeight > dynamicDropdowns.many.clientHeight, true);
    assert.equal(dynamicDropdowns.many.selectedVisible, true);
    assert.equal(Math.abs(desktopLayout.dialogWidth - 900) <= 1, true);
    assert.deepEqual({
      targetColumns: desktopLayout.targetColumns,
      detailColumns: desktopLayout.detailColumns,
      headerActionDisplay: desktopLayout.headerActionDisplay,
      headerButtonsGrouped: desktopLayout.headerButtonsGrouped,
      targetAligned: desktopLayout.targetAligned,
      sourceDeleteAligned: desktopLayout.sourceDeleteAligned,
      controlsWithinFields: desktopLayout.controlsWithinFields,
      noHorizontalOverflow: desktopLayout.noHorizontalOverflow,
      rowSeparated: desktopLayout.rowSeparated,
      fixedChrome: desktopLayout.fixedChrome
    }, {
      targetColumns: 3,
      detailColumns: 4,
      headerActionDisplay: 'flex',
      headerButtonsGrouped: true,
      targetAligned: true,
      sourceDeleteAligned: true,
      controlsWithinFields: true,
      noHorizontalOverflow: true,
      rowSeparated: true,
      fixedChrome: true
    });
    assert.equal(intermediateLayout.targetColumns, 3);
    assert.equal(intermediateLayout.detailColumns, 2);
    assert.equal(intermediateLayout.noHorizontalOverflow, true);
    assert.deepEqual({
      targetColumns: mobileLayout.targetColumns,
      detailColumns: mobileLayout.detailColumns,
      headerActionDisplay: mobileLayout.headerActionDisplay,
      headerActionColumns: mobileLayout.headerActionColumns,
      headerButtonsGrouped: mobileLayout.headerButtonsGrouped,
      controlsWithinFields: mobileLayout.controlsWithinFields,
      noHorizontalOverflow: mobileLayout.noHorizontalOverflow,
      rowSeparated: mobileLayout.rowSeparated,
      fixedChrome: mobileLayout.fixedChrome
    }, {
      targetColumns: 1,
      detailColumns: 1,
      headerActionDisplay: 'grid',
      headerActionColumns: 2,
      headerButtonsGrouped: true,
      controlsWithinFields: true,
      noHorizontalOverflow: true,
      rowSeparated: true,
      fixedChrome: true
    });
    for (const dropdown of zoomedDropdowns) {
      assert.equal([0.3, 1, 3].includes(dropdown.bodyZoom), true);
      for (const property of ['left', 'top', 'width', 'maxHeight']) {
        assert.ok(Math.abs(dropdown.actual[property] - dropdown.expected[property]) <= 0.01);
      }
      assert.equal(dropdown.actual.viewportContained, true);
      assert.equal(dropdown.actual.aligned, true);
    }
    assert.equal(settingsDropdown.open, true);
    assert.equal(settingsDropdown.optionsMatch, true);
    assert.equal(settingsDropdown.scrollHeight, settingsDropdown.clientHeight);
    assert.equal(settingsDropdown.scrollbarGutter, 0);
    assert.equal(settingsDropdown.nativePopupOpen, false);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
    await context.close();
  }
}
