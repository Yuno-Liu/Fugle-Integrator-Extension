/**
 * ============================================================================
 * 🔀 訊息路由（background）
 * ============================================================================
 */

import type { Request, ResponseMap } from "../shared/messages";
import { LIMITS } from "../shared/constants";
import type { JsonCache } from "./cache";
import type { DatasetService } from "./datasets";
import type { StockDbService } from "./stockdb";

export interface RouterServices {
    datasets: DatasetService;
    stockDb: StockDbService;
    cache: JsonCache;
    openOptions: () => Promise<void>;
    version: string;
}

/** 處理已驗證的請求，回傳對應資料（錯誤以拋出方式回報） */
export async function route(req: Request, services: RouterServices): Promise<ResponseMap[Request["type"]]> {
    switch (req.type) {
        case "dataset":
            return services.datasets.get(req.name, req.stockId, req.force === true);
        case "related": {
            const index = await services.stockDb.getIndex();
            return index.related(req.stockId, req.extra, req.limit);
        }
        case "category": {
            const index = await services.stockDb.getIndex();
            return index.members(req.categoryType, req.name, req.exclude);
        }
        case "search": {
            const index = await services.stockDb.getIndex();
            return index.search(req.query, LIMITS.searchStocks, LIMITS.searchCategories);
        }
        case "clearCache":
            await services.cache.clear();
            return { cleared: true };
        case "openOptions":
            await services.openOptions();
            return { opened: true };
        case "ping":
            return { version: services.version };
    }
}
