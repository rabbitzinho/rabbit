(function () {
  const I18n = {
    currentLang: "pt",
    translations: {},
    fallbackTranslations: {},
    initSequence: 0,

    async init(lang) {
      const requestSequence = ++this.initSequence;
      const selectedLang = lang === "en" ? "en" : "pt";

      // Carregar sempre PT como fallback
      if (!this.fallbackTranslations.pt) {
        await this.loadLocale("pt");
        if (requestSequence === this.initSequence) {
          this.fallbackTranslations.pt =
            (window.OzarkLocales && window.OzarkLocales.pt) || {};
        }
      }

      if (selectedLang !== "pt") {
        await this.loadLocale(selectedLang);
      }
      if (requestSequence !== this.initSequence) return;

      this.currentLang = selectedLang;
      if (selectedLang !== "pt") {
        this.translations =
          (window.OzarkLocales && window.OzarkLocales[selectedLang]) || {};
      } else {
        this.translations = this.fallbackTranslations.pt;
      }

      // DOM será atualizado via applyI18n() do dashboard.
    },

    loadLocale(lang) {
      return new Promise(function (resolve, reject) {
        if (window.OzarkLocales && window.OzarkLocales[lang]) {
          return resolve();
        }
        const script = document.createElement("script");
        // Cache-bust locale bundles aggressively. Some hosts/proxies cache /locales/*.js
        // and browsers keep stale versions around.
        var build =
          window && (window.OZARK_BUILD || window.OZARK_VERSION)
            ? window.OZARK_BUILD || window.OZARK_VERSION
            : String(Date.now());
        script.src = "/locales/" + lang + ".js?v=" + encodeURIComponent(build);
        script.async = true;
        script.onload = function () {
          resolve();
        };
        script.onerror = function (err) {
          console.error("Falha ao carregar locale", lang, err);
          reject(new Error("LOCALE_LOAD_FAILED: " + lang));
        };
        document.head.appendChild(script);
      });
    },

    t(key, params) {
      params = params || {};
      const value =
        this.lookup(this.translations, key) ||
        this.lookup(this.fallbackTranslations.pt || {}, key);

      if (!value) return key;
      return this.interpolate(value, params);
    },

    lookup(obj, key) {
      if (!obj) return null;
      const parts = key.split(".");
      let cur = obj;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!Object.prototype.hasOwnProperty.call(cur, p)) return null;
        cur = cur[p];
      }
      return typeof cur === "string" ? cur : null;
    },

    interpolate(str, params) {
      return str.replace(/\{(\w+)\}/g, function (_, v) {
        return Object.prototype.hasOwnProperty.call(params, v)
          ? String(params[v])
          : "{" + v + "}";
      });
    },
  };

  window.OzarkDashboard = window.OzarkDashboard || {};
  window.OzarkDashboard.I18n = I18n;
})();
