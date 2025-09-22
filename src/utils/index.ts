import { HTTP, Logger, Session } from "koishi";
import { OverRetryError } from "../error/overRetry.error";
import { WorkshopInfo } from "../types";

/**
 * 重试请求，直到遇到特定错误或者次数耗尽
 * @param url 请求地址
 * @param method 请求方法
 * @param config 请求配置
 * @param retryIndex 尝试次数
 * @returns 请求结果
 */
export async function requestWithRetry<T>(
  http: HTTP,
  logger: Logger,
  retryCount: number,
  url: string,
  method: "GET" | "POST",
  config: HTTP.RequestConfig = {},
  retryIndex: number = 0
) {
  try {
    const res = await http(method, url, config);
    return res.data as T;
  } catch (error) {
    if (retryIndex < retryCount) {
      logger.info(
        `${url} 请求失败，正在重试... ${retryIndex + 1}/${retryCount}`
      );
      return await requestWithRetry<T>(
        http,
        logger,
        retryCount,
        url,
        method,
        config,
        retryIndex + 1
      );
    } else {
      throw new OverRetryError(`请求失败，超过最大重试次数: ${url}`);
    }
  }
}

export function formatFileName(
  logger: Logger,
  item: WorkshopInfo,
  session: Session
) {
  const invalidReg = /[\\/:\*\?"\<\>\|\r\n]/g;
  const ext = item.filename.substring(item.filename.lastIndexOf("."));
  const name = item.title.replace(invalidReg, " ");
  const download_name = `${name.trim()}${ext}`;
  logger.info(session.text(".download_info", [download_name, item.file_url]));
  return download_name;
}
