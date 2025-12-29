/**
 * 🎨 樣式注入模組 - TypeScript 版本
 */

/**
 * 注入全域樣式
 */
export function injectStyles(): void {
    if (document.querySelector("#custom-analysis-style")) return;
    const style = document.createElement("style");
    style.id = "custom-analysis-style";
    style.textContent = `
        :root {
            --fugle-bg: #1e1e1e;
            --fugle-card-bg: #252526;
            --fugle-border: #333333;
            --fugle-primary: #6366f1;
            --fugle-text: #d4d4d4;
            --fugle-text-muted: #808080;
            --fugle-accent: #ff9f43;
        }
        #stock-info-card {
            background: var(--fugle-card-bg);
            border: 1px solid var(--fugle-border);
            border-left: 4px solid var(--fugle-primary);
            padding: 16px;
            margin: 12px 0;
            font-family: "Inter", "Segoe UI", "Microsoft JhengHei", sans-serif;
            font-size: 14px;
            border-radius: 8px;
            color: var(--fugle-text);
            box-shadow: 0 8px 24px rgba(0,0,0,0.2);
            line-height: 1.6;
        }
        #stock-info-card.fixed-mode {
            position: fixed;
            top: 100px;
            width: 500px;
            z-index: 9999;
            max-height: 80vh;
            overflow-y: auto;
            margin: 0;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        }
        #stock-info-card.fixed-mode::-webkit-scrollbar { width: 6px; }
        #stock-info-card.fixed-mode::-webkit-scrollbar-track { background: #1e1e1e; }
        #stock-info-card.fixed-mode::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
        #stock-info-card.fixed-mode::-webkit-scrollbar-thumb:hover { background: #555; }
        .info-section {
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #333;
        }
        .info-section:last-child {
            margin-bottom: 0;
            padding-bottom: 0;
            border-bottom: none;
        }
        .info-row {
            display: flex;
            align-items: flex-start;
            margin-bottom: 6px;
        }
        .info-label {
            width: 70px;
            min-width: 70px;
            color: var(--fugle-text-muted);
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .info-content {
            flex: 1;
            word-break: break-all;
        }
        .rating-tag {
            display: inline-block;
            background: #2d2d2d;
            padding: 2px 8px;
            border-radius: 4px;
            margin-right: 6px;
            margin-bottom: 4px;
            border: 1px solid #444;
            font-size: 12px;
            transition: all 0.2s;
        }
        .rating-tag:hover {
            border-color: var(--fugle-primary);
            background: #333;
        }
        .custom-analysis-btn {
            background: #2d2d2d;
            color: #ccc;
            border: 1px solid #444;
            padding: 5px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            transition: 0.2s cubic-bezier(0.4, 0, 0.2, 1);
            white-space: nowrap;
        }
        .custom-analysis-btn:hover {
            background: var(--fugle-primary);
            border-color: var(--fugle-primary);
            color: #fff;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
        }

        /* Toggle Switch Styles */
        .switch { position: relative; display: inline-block; width: 34px; height: 18px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #444; transition: .4s; border-radius: 34px; }
        .slider:before { position: absolute; content: ""; height: 12px; width: 12px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--fugle-primary); }
        input:checked + .slider:before { transform: translateX(16px); }

        /* Search Modal Styles */
        #fugle-search-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding-top: 100px;
            backdrop-filter: blur(2px);
        }
        .search-modal-content {
            background: #252526;
            width: 500px;
            max-width: 90%;
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            border: 1px solid #444;
            display: flex;
            flex-direction: column;
            max-height: 80vh;
        }
        .search-header {
            padding: 16px;
            border-bottom: 1px solid #333;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: #fff;
        }
        .close-btn {
            font-size: 24px;
            cursor: pointer;
            color: #888;
            transition: color 0.2s;
        }
        .close-btn:hover { color: #fff; }
        .search-body {
            padding: 16px;
            overflow-y: auto;
        }
        #category-search-input {
            width: 100%;
            padding: 10px;
            background: #1e1e1e;
            border: 1px solid #444;
            border-radius: 4px;
            color: #fff;
            font-size: 16px;
            margin-bottom: 16px;
            box-sizing: border-box;
        }
        #category-search-input:focus {
            outline: none;
            border-color: var(--fugle-primary);
        }
        .search-result-item {
            padding: 10px;
            border-bottom: 1px solid #333;
            cursor: pointer;
            display: flex;
            align-items: center;
            transition: background 0.2s;
        }
        .search-result-item:hover {
            background: #333;
        }
        .result-tag {
            font-size: 12px;
            padding: 2px 6px;
            border-radius: 4px;
            margin-right: 10px;
            font-weight: bold;
            white-space: nowrap;
        }
        .tag-concept { background: rgba(82, 196, 26, 0.2); color: #52c41a; }
        .tag-industry { background: rgba(69, 170, 242, 0.2); color: #45aaf2; }
        .tag-group { background: rgba(236, 59, 97, 0.2); color: #ec3b61; }
        .tag-stock { background: rgba(255, 255, 255, 0.1); color: #fff; border: 1px solid #555; }
        .result-name {
            color: #d4d4d4;
            font-size: 14px;
        }
        .stock-chip {
            display: inline-block;
            background: #333;
            color: #d4d4d4;
            padding: 6px 12px;
            border-radius: 20px;
            text-decoration: none;
            font-size: 13px;
            border: 1px solid #444;
            transition: all 0.2s;
        }
        .stock-chip:hover {
            background: var(--fugle-primary);
            color: #fff;
            border-color: var(--fugle-primary);
            transform: translateY(-1px);
        }

        /* Sticky Headers for Fixed Mode */
        #stock-info-card.fixed-mode #info-header {
            position: sticky;
            top: 0;
            background-color: var(--fugle-card-bg);
            z-index: 20;
            margin-top: -16px;
            padding-top: 16px;
            border-bottom: 1px solid var(--fugle-border);
        }
        #stock-info-card.fixed-mode .section-header {
            position: sticky;
            top: 74px;
            background-color: var(--fugle-card-bg);
            z-index: 15;
        }

        /* Token Modal Styles */
        #fugle-token-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.7);
            z-index: 10000;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding-top: 100px;
            backdrop-filter: blur(2px);
        }
        .token-modal-content {
            background: #252526;
            width: 500px;
            max-width: 90%;
            border-radius: 8px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            border: 1px solid #444;
            display: flex;
            flex-direction: column;
        }
        .token-modal-header {
            padding: 16px;
            border-bottom: 1px solid #333;
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: #fff;
        }
        .token-modal-body {
            padding: 16px;
        }
    `;
    document.head.appendChild(style);
}

/**
 * 🔗 注入關係鏈連結樣式
 */
export function injectChainStyles(): void {
    if (document.querySelector("#chain-link-style")) return;
    const style = document.createElement("style");
    style.id = "chain-link-style";
    style.textContent = `
        .sup-link, .cus-link, .riv-link, .all-link, .out-link, .in-link, .etf-link, .relation-link, .concept-link, .industry-link, .group-link { text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; transition: 0.2s; }
        .sup-link { color: #45aaf2; } .sup-link:hover { color: #2d98da; text-decoration-style: solid; }
        .cus-link { color: #a55eea; } .cus-link:hover { color: #8854d0; text-decoration-style: solid; }
        .riv-link { color: #fc5c65; } .riv-link:hover { color: #eb3b5a; text-decoration-style: solid; }
        .all-link { color: #f78fb3; } .all-link:hover { color: #cf6a87; text-decoration-style: solid; }
        .out-link { color: #ff9f43; } .out-link:hover { color: #f7b731; text-decoration-style: solid; }
        .in-link { color: #4ecdc4; } .in-link:hover { color: #26dead; text-decoration-style: solid; }
        .etf-link { color: #7289da; } .etf-link:hover { color: #5b6eae; text-decoration-style: solid; }
        .relation-link { color: #52c41a; } .relation-link:hover { color: #389e0d; text-decoration-style: solid; }
        .concept-link { color: #52c41a; } .concept-link:hover { color: #389e0d; text-decoration-style: solid; }
        .industry-link { color: #45aaf2; } .industry-link:hover { color: #2d98da; text-decoration-style: solid; }
        .group-link { color: #f78fb3; } .group-link:hover { color: #cf6a87; text-decoration-style: solid; }
    `;
    document.head.appendChild(style);
}
