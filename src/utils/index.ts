import { HTTP } from "koishi";
import { http, logger, retryCount } from "..";
import { OverRetryError } from "../error/overRetry.error";

/**
 * 重试请求，直到遇到特定错误或者次数耗尽
 * @param url 请求地址
 * @param method 请求方法
 * @param config 请求配置
 * @param retryIndex 尝试次数
 * @returns 请求结果
 */
export async function requestWithRetry<T>(
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
      return await requestWithRetry<T>(url, method, config, retryIndex + 1);
    } else {
      throw new OverRetryError(`请求失败，超过最大重试次数: ${url}`);
    }
  }
}
