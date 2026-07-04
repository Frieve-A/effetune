(function () {
  const LANGUAGE_STORAGE_KEY = "effetune.site.language";
  const languages = readLanguageData();
  const languageCodes = new Set(languages.map((language) => language.code));
  const defaultLanguage = languageCodes.has("en") ? "en" : languages[0]?.code || "en";
  const preferredLanguage = getPreferredLanguage();
  const defaultUiText = {
    searching: "Searching...",
    searchUnavailable: "Search unavailable",
    noMatches: "No matches",
    documentation: "Documentation",
    copy: "Copy",
    copied: "Copied",
    select: "Select"
  };
  const uiText = { ...defaultUiText, ...readUiText() };

  const navToggle = document.querySelector("[data-nav-toggle]");
  const siteNav = document.querySelector("[data-site-nav]");

  if (navToggle && siteNav) {
    navToggle.addEventListener("click", () => {
      const isOpen = siteNav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });
  }

  setupLanguageControls(preferredLanguage);
  redirectToPreferredLanguage(preferredLanguage);
  setupInstallElements();

  const currentPath = normalizePath(window.location.pathname);
  document.querySelectorAll("a[href]").forEach((link) => {
    rewriteMarkdownLink(link);

    const url = new URL(link.getAttribute("href"), window.location.href);
    if (url.origin === window.location.origin && normalizePath(url.pathname) === currentPath) {
      link.classList.add("is-active");
    }
  });

  const search = document.querySelector("[data-doc-search]");
  const nav = document.querySelector("[data-doc-nav]");
  const searchResults = document.querySelector("[data-doc-search-results]");
  let searchIndexPromise = null;
  let searchEntries = [];
  let activeSearchRequest = 0;
  if (search && nav && searchResults) {
    search.addEventListener("input", () => {
      const query = search.value.trim();
      const requestId = ++activeSearchRequest;

      if (query.length === 0) {
        showNavigationSearchState();
        return;
      }

      showSearchMessage(uiText.searching);
      loadDocSearchIndex()
        .then(() => {
          if (requestId !== activeSearchRequest) return;
          renderDocSearchResults(query);
        })
        .catch(() => {
          if (requestId !== activeSearchRequest) return;
          showSearchMessage(uiText.searchUnavailable);
        });
    });
  }

  const article = document.querySelector("[data-content]");
  const toc = document.querySelector("[data-page-toc]");
  if (article && toc) {
    const headings = Array.from(article.querySelectorAll("h2, h3")).filter((heading) => {
      return heading.textContent.trim().length > 0;
    });

    const tocLinksByHeading = new Map();
    headings.forEach((heading) => {
      if (!heading.id) {
        heading.id = slugify(heading.textContent);
      }
      const item = document.createElement("a");
      item.href = `#${heading.id}`;
      item.textContent = heading.textContent;
      item.className = `toc-level-${heading.tagName.toLowerCase().replace("h", "")}`;
      toc.appendChild(item);
      tocLinksByHeading.set(heading, item);
    });

    if (headings.length === 0 && toc.parentElement) {
      toc.parentElement.hidden = true;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        toc.querySelectorAll("a").forEach((link) => link.classList.remove("is-active"));
        const active = tocLinksByHeading.get(entry.target);
        if (active) active.classList.add("is-active");
      });
    }, { rootMargin: "-20% 0px -70% 0px", threshold: 0.01 });

    headings.forEach((heading) => observer.observe(heading));
  }

  const tocToggle = document.querySelector("[data-toc-toggle]");
  const tocClose = document.querySelector("[data-toc-close]");
  const docsToc = document.querySelector(".docs-toc");
  const docsNavToggle = document.querySelector("[data-docs-nav-toggle]");
  const docsNavClose = document.querySelector("[data-docs-nav-close]");
  const docsSidebar = document.querySelector(".docs-sidebar");
  if (tocToggle) {
    tocToggle.addEventListener("click", () => {
      setTocVisible(!document.body.classList.contains("toc-visible"));
    });
  }

  if (tocClose) {
    tocClose.addEventListener("click", () => {
      setTocVisible(false);
    });
  }

  if (docsToc) {
    docsToc.addEventListener("click", (event) => {
      if (event.target === docsToc) {
        setTocVisible(false);
      }
    });
  }

  if (docsNavToggle) {
    docsNavToggle.addEventListener("click", () => {
      setDocsNavVisible(!document.body.classList.contains("docs-nav-visible"));
    });
  }

  if (docsNavClose) {
    docsNavClose.addEventListener("click", () => {
      setDocsNavVisible(false);
    });
  }

  if (docsSidebar) {
    docsSidebar.addEventListener("click", (event) => {
      if (event.target === docsSidebar) {
        setDocsNavVisible(false);
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setTocVisible(false);
      setDocsNavVisible(false);
    }
  });

  document.querySelectorAll("[data-page-toc] a").forEach((link) => {
    link.addEventListener("click", () => {
      setTocVisible(false);
    });
  });

  document.querySelectorAll("[data-doc-nav] a").forEach((link) => {
    link.addEventListener("click", () => {
      setDocsNavVisible(false);
    });
  });

  if (searchResults) {
    searchResults.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        setDocsNavVisible(false);
      }
    });
  }

  document.querySelectorAll("pre > code").forEach((code) => {
    const pre = code.parentElement;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-code";
    button.textContent = uiText.copy;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = uiText.copied;
        window.setTimeout(() => {
          button.textContent = uiText.copy;
        }, 1400);
      } catch (_error) {
        button.textContent = uiText.select;
      }
    });
    pre.appendChild(button);
  });

  function readLanguageData() {
    const dataElement = document.getElementById("site-language-data");
    if (!dataElement) return [];

    try {
      const parsed = JSON.parse(dataElement.textContent);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter((language) => {
          return language && typeof language === "object" && isLanguageCode(language.code) && typeof language.url === "string";
        })
        .map((language) => ({ ...language, code: language.code.toLowerCase() }));
    } catch (_error) {
      return [];
    }
  }

  function readUiText() {
    const dataElement = document.getElementById("site-ui-text");
    if (!dataElement) return {};

    try {
      const parsed = JSON.parse(dataElement.textContent);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

      const mapped = {
        searching: parsed.searching,
        searchUnavailable: parsed.search_unavailable,
        noMatches: parsed.no_matches,
        documentation: parsed.documentation,
        copy: parsed.copy,
        copied: parsed.copied,
        select: parsed.select
      };
      return Object.fromEntries(Object.entries(mapped).filter((entry) => typeof entry[1] === "string"));
    } catch (_error) {
      return {};
    }
  }

  function setTocVisible(isVisible) {
    if (isVisible) {
      setDocsNavVisible(false);
      closeSiteNav();
    }
    document.body.classList.toggle("toc-visible", isVisible);
    if (tocToggle) {
      tocToggle.setAttribute("aria-expanded", String(isVisible));
    }
  }

  function setDocsNavVisible(isVisible) {
    if (isVisible) {
      setTocVisible(false);
      closeSiteNav();
    }
    document.body.classList.toggle("docs-nav-visible", isVisible);
    if (docsNavToggle) {
      docsNavToggle.setAttribute("aria-expanded", String(isVisible));
    }
    if (isVisible && search) {
      window.setTimeout(() => search.focus({ preventScroll: true }), 0);
    }
  }

  function closeSiteNav() {
    if (siteNav) {
      siteNav.classList.remove("is-open");
    }
    if (navToggle) {
      navToggle.setAttribute("aria-expanded", "false");
    }
  }

  function setupInstallElements() {
    const installElements = Array.from(document.querySelectorAll("install"));
    if (installElements.length === 0) return;

    registerSiteServiceWorker();
    if ("HTMLInstallElement" in window) return;

    let deferredInstallPrompt = null;

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      installElements.forEach((element) => element.classList.add("is-install-available"));
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      installElements.forEach((element) => element.classList.remove("is-install-available"));
    });

    installElements.forEach((element) => {
      element.addEventListener("click", async (event) => {
        if (!deferredInstallPrompt) return;

        event.preventDefault();
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        installElements.forEach((item) => item.classList.remove("is-install-available"));

        try {
          await promptEvent.prompt();
          await promptEvent.userChoice;
        } catch (_error) {
          // The fallback link remains available when the browser cannot show a prompt.
        }
      });
    });
  }

  function registerSiteServiceWorker() {
    if (window.EFFECTUNE_DEV_SERVER === true) return;
    if (!navigator.serviceWorker || !/^https?:$/.test(window.location.protocol)) return;

    const register = () => {
      navigator.serviceWorker.register(getServiceWorkerUrl()).catch((error) => {
        console.warn("Service worker registration failed:", error);
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }

  function getServiceWorkerUrl() {
    const manifestLink = document.querySelector('link[rel="manifest"][href]');
    if (manifestLink) {
      return new URL("sw.js", manifestLink.href).href;
    }

    return new URL("/sw.js", window.location.origin).href;
  }

  function loadDocSearchIndex() {
    if (searchIndexPromise) return searchIndexPromise;

    const indexUrl = search?.getAttribute("data-doc-search-index");
    if (!indexUrl) {
      searchIndexPromise = Promise.reject(new Error("Missing documentation search index."));
      return searchIndexPromise;
    }

    searchIndexPromise = fetch(indexUrl, { credentials: "same-origin" })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load documentation search index: ${response.status}`);
        }
        return response.json();
      })
      .then((entries) => {
        searchEntries = Array.isArray(entries) ? entries.map(normalizeSearchEntry) : [];
        return searchEntries;
      });

    return searchIndexPromise;
  }

  function normalizeSearchEntry(entry) {
    const rawContent = String(entry.content || "");
    const title = cleanSearchText(getSearchTitle(entry, rawContent));
    const description = cleanSearchText(entry.description || "");
    const content = cleanSearchText(rawContent);
    const url = String(entry.url || "#");

    return {
      url,
      title,
      description,
      content,
      path: formatSearchPath(url),
      searchText: normalizeSearchText(`${title} ${description} ${content}`),
      titleText: normalizeSearchText(title),
      descriptionText: normalizeSearchText(description),
      contentText: normalizeSearchText(content)
    };
  }

  function getSearchTitle(entry, rawContent) {
    const headingMatch = rawContent.match(/^\s*#\s+(.+)$/m);
    if (headingMatch && headingMatch[1]) {
      return headingMatch[1];
    }
    return entry.title || uiText.documentation;
  }

  function renderDocSearchResults(query) {
    const terms = getSearchTerms(query);
    if (terms.length === 0) {
      showNavigationSearchState();
      return;
    }

    const matches = searchEntries
      .map((entry) => scoreSearchEntry(entry, terms))
      .filter(Boolean)
      .sort((a, b) => {
        if (a.score !== b.score) return b.score - a.score;
        return a.entry.title.localeCompare(b.entry.title);
      })
      .slice(0, 8);

    if (matches.length === 0) {
      showSearchMessage(uiText.noMatches);
      return;
    }

    searchResults.replaceChildren(...matches.map((match) => createSearchResult(match.entry, terms)));
    searchResults.hidden = false;
    nav.hidden = true;
  }

  function scoreSearchEntry(entry, terms) {
    let score = 0;

    for (const term of terms) {
      if (!entry.searchText.includes(term)) {
        return null;
      }

      if (entry.titleText.includes(term)) score += 45;
      if (entry.descriptionText.includes(term)) score += 18;
      score += countSearchTerm(entry.contentText, term, 8);
    }

    return { entry, score };
  }

  function countSearchTerm(text, term, limit) {
    let count = 0;
    let position = 0;

    while (count < limit) {
      const index = text.indexOf(term, position);
      if (index === -1) break;
      count += 1;
      position = index + term.length;
    }

    return count;
  }

  function createSearchResult(entry, terms) {
    const link = document.createElement("a");
    link.className = "search-result";
    setInternalHref(link, entry.url);

    const title = document.createElement("span");
    title.className = "search-result-title";
    title.textContent = entry.title;

    const path = document.createElement("span");
    path.className = "search-result-path";
    path.textContent = entry.path;

    const snippet = document.createElement("p");
    snippet.className = "search-result-snippet";
    snippet.textContent = getSearchSnippet(entry, terms);

    link.append(title, path, snippet);
    return link;
  }

  function getSearchSnippet(entry, terms) {
    const source = entry.content || entry.description || entry.title;
    const normalizedSource = normalizeSearchText(source);
    let index = -1;

    for (const term of terms) {
      index = normalizedSource.indexOf(term);
      if (index !== -1) break;
    }

    if (index === -1) {
      return truncateSearchText(source, 150);
    }

    let start = index - 52;
    if (start < 0) start = 0;

    let end = start + 150;
    if (end > source.length) end = source.length;

    const prefix = start > 0 ? "..." : "";
    const suffix = end < source.length ? "..." : "";
    return `${prefix}${source.slice(start, end).trim()}${suffix}`;
  }

  function truncateSearchText(text, limit) {
    if (text.length <= limit) return text;
    return `${text.slice(0, limit).trim()}...`;
  }

  function showNavigationSearchState() {
    if (searchResults) {
      searchResults.replaceChildren();
      searchResults.hidden = true;
    }
    if (nav) {
      nav.hidden = false;
    }
  }

  function showSearchMessage(message) {
    const item = document.createElement("div");
    item.className = "search-result-message";
    item.textContent = message;
    searchResults.replaceChildren(item);
    searchResults.hidden = false;
    nav.hidden = true;
  }

  function getSearchTerms(query) {
    return normalizeSearchText(query).split(/\s+/).filter(Boolean);
  }

  function normalizeSearchText(value) {
    const lowered = String(value).toLocaleLowerCase();
    return lowered.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }

  function cleanSearchText(value) {
    return String(value)
      .replace(/\{%-?[\s\S]*?-?%\}/g, " ")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/[#>*_~|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatSearchPath(url) {
    try {
      return new URL(url, window.location.origin).pathname
        .replace(/\/index\.html$/, "/")
        .replace(/\/$/, "") || "/";
    } catch (_error) {
      return url;
    }
  }

  function setupLanguageControls(language) {
    const select = document.querySelector("[data-language-select]");
    if (select) {
      select.value = language;
      select.addEventListener("change", () => {
        const nextLanguage = toSupportedLanguageCode(select.value);
        writeStoredLanguage(nextLanguage);
        const target = getLanguageTarget(nextLanguage);
        const targetUrl = target ? withCurrentLocationParts(target) : null;
        if (targetUrl) {
          window.location.assign(targetUrl);
        } else {
          select.value = nextLanguage;
        }
      });
    }

    document.querySelectorAll(".language-strip a[lang], .nav-section-languages a[lang]").forEach((link) => {
      const languageCode = toSupportedLanguageCode(link.getAttribute("lang"));
      const target = getLanguageTarget(languageCode);
      if (target) {
        setInternalHref(link, target);
      }
      link.addEventListener("click", () => {
        writeStoredLanguage(languageCode);
      });
    });
  }

  function getPreferredLanguage() {
    const stored = readStoredLanguage();
    if (stored) return stored;

    const detected = detectBrowserLanguage();
    writeStoredLanguage(detected);
    return detected;
  }

  function detectBrowserLanguage() {
    const browserLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language || defaultLanguage];

    for (const language of browserLanguages) {
      const supported = toSupportedLanguageCode(language, false);
      if (supported) return supported;
    }

    return defaultLanguage;
  }

  function readStoredLanguage() {
    try {
      return toSupportedLanguageCode(window.localStorage.getItem(LANGUAGE_STORAGE_KEY), false);
    } catch (_error) {
      return null;
    }
  }

  function writeStoredLanguage(language) {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, toSupportedLanguageCode(language));
    } catch (_error) {
      // Private browsing or storage policies can block persistence; navigation still works.
    }
  }

  function toSupportedLanguageCode(language, useDefault = true) {
    if (!language) return useDefault ? defaultLanguage : null;

    const normalized = String(language).toLowerCase().replace(/_/g, "-");
    if (!/^[a-z]{2}(?:-[a-z0-9]+)*$/.test(normalized)) {
      return useDefault ? defaultLanguage : null;
    }

    if (languageCodes.has(normalized)) return normalized;

    const baseLanguage = normalized.split("-")[0];
    if (languageCodes.has(baseLanguage)) return baseLanguage;

    return useDefault ? defaultLanguage : null;
  }

  function redirectToPreferredLanguage(language) {
    const target = getLanguageTarget(language);
    if (!target) return;

    const targetUrl = toSameOriginUrl(target, window.location.origin);
    if (!targetUrl) return;

    const targetPath = normalizePath(targetUrl.pathname);
    if (targetPath === normalizePath(window.location.pathname)) return;

    const targetWithLocationParts = withCurrentLocationParts(targetUrl.href);
    if (targetWithLocationParts) {
      window.location.replace(targetWithLocationParts);
    }
  }

  function getLanguageTarget(language) {
    const targetLanguage = toSupportedLanguageCode(language);
    if (!isLanguageCode(targetLanguage)) return null;

    const pageInfo = getLocalizablePageInfo(window.location.pathname);
    if (!pageInfo.localizable) return null;

    if (targetLanguage === "en") {
      return pageInfo.englishPath;
    }

    return `/docs/i18n/${targetLanguage}${pageInfo.localizedSuffix}`;
  }

  function getLocalizablePageInfo(pathname) {
    const path = pathname.replace(/\/index\.html$/, "/");
    const localizedMatch = path.match(/^\/docs\/i18n\/([a-z]{2})(\/.*)?$/);

    if (localizedMatch) {
      if (!languageCodes.has(localizedMatch[1])) {
        return { localizable: false };
      }
      const suffix = localizedMatch[2] || "/";
      if (suffix === "/") {
        return { localizable: true, englishPath: "/", localizedSuffix: "/" };
      }
      if (isLocalizedDocSuffix(suffix)) {
        return { localizable: true, englishPath: `/docs${suffix}`, localizedSuffix: suffix };
      }
      return { localizable: false };
    }

    if (path === "/") {
      return { localizable: true, englishPath: "/", localizedSuffix: "/" };
    }

    const englishMatch = path.match(/^\/docs(\/.*)$/);
    if (englishMatch && isLocalizedDocSuffix(englishMatch[1])) {
      return { localizable: true, englishPath: path, localizedSuffix: englishMatch[1] };
    }

    return { localizable: false };
  }

  function isLocalizedDocSuffix(suffix) {
    return /^\/(?:faq|bus-function|double-blind-test)\.html$/.test(suffix) || /^\/plugins\/[a-z0-9-]+\.html$/.test(suffix);
  }

  function withCurrentLocationParts(path) {
    const url = toSameOriginUrl(path, window.location.origin);
    if (!url) return null;

    url.search = window.location.search;
    url.hash = window.location.hash;
    return url.href;
  }

  function rewriteMarkdownLink(link) {
    const original = link.getAttribute("href");
    if (!original || original.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(original)) {
      return;
    }

    const hashIndex = original.indexOf("#");
    const hash = hashIndex >= 0 ? original.slice(hashIndex) : "";
    const path = hashIndex >= 0 ? original.slice(0, hashIndex) : original;

    if (!path.endsWith(".md")) return;

    let rewritten;
    if (path === "README.md") {
      rewritten = "./";
    } else if (path.endsWith("/README.md")) {
      rewritten = path.slice(0, -"README.md".length);
    } else {
      rewritten = path.slice(0, -".md".length) + ".html";
    }

    setInternalHref(link, rewritten + hash);
  }

  function normalizePath(path) {
    return path.replace(/\/index\.html$/, "/").replace(/\/$/, "") || "/";
  }

  function slugify(text) {
    return text
      .trim()
      .toLowerCase()
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section";
  }

  function isLanguageCode(value) {
    return typeof value === "string" && /^[a-z]{2}$/i.test(value);
  }

  function setInternalHref(link, path) {
    const url = toSameOriginUrl(path);
    if (url) {
      link.href = url.href;
    }
  }

  function toSameOriginUrl(path, base = window.location.href) {
    try {
      const url = new URL(path, base);
      return url.origin === window.location.origin ? url : null;
    } catch (_error) {
      return null;
    }
  }
})();
