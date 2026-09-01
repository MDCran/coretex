// Apply persisted theme tokens before React mounts to avoid a light/dark flash.
(function () {
    try {
        var root = document.documentElement;
        var mode = localStorage.getItem("coretex-theme") || "dark";
        var dark = mode === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : mode === "dark";
        root.setAttribute("data-theme", dark ? "dark" : "light");
        root.classList.toggle("dark-mode", dark);
        root.style.colorScheme = dark ? "dark" : "light";
        var accent = localStorage.getItem("coretex-accent");
        if (accent && /^#?[0-9a-f]{6}$/i.test(accent)) {
            root.style.setProperty("--brand", accent[0] === "#" ? accent : "#" + accent);
        }
        var scheme = localStorage.getItem("coretex-scheme");
        if (scheme) {
            var palette = JSON.parse(scheme);
            if (palette && palette.background && palette.foreground) {
                root.style.setProperty("--app-bg", palette.background);
                root.style.setProperty("--c-text-primary", palette.foreground);
            }
        }
    } catch (_error) {
        var fallback = document.documentElement;
        fallback.setAttribute("data-theme", "dark");
        fallback.classList.add("dark-mode");
        fallback.style.colorScheme = "dark";
    }
})();
