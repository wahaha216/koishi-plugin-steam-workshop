import { Context, HTTP, Logger, Schema, h, segment, sleep } from "koishi";
import { sizeFormat, timestampToDate } from "./utils/sizeFormat";
import { FileInfo } from "./types";
import { Aria2Params, Aria2Respond, Aria2TellStatus } from "./types/Aria2";
import {} from "@koishijs/plugin-logger";
import {} from "@koishijs/plugin-http";
import { requestWithRetry } from "./utils";

export const name = "steam-workshop";

const WORKSHOP_API = "https://steamworkshopdownloader.io/api/details/file";

export interface Config {
  autoRecognise?: boolean;
  askDownload?: boolean;
  requestRetries?: number;
  downloadRetries?: number;
  threadCount?: number;
  inputTimeout?: number;
  rpc?: boolean;
  rpcIp?: string;
  rpcPort?: number;
  rpcSecure?: boolean;
  rpcSecret?: string;
  rpcPolling?: number;
  rpcPollingCount?: number;
  rpcDir?: string;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    autoRecognise: Schema.boolean().default(true),
    askDownload: Schema.boolean().default(true),
  }),
  Schema.union([
    Schema.object({
      askDownload: Schema.const(true),
      requestRetries: Schema.number().default(5).min(0).max(10),
      downloadRetries: Schema.number().default(5).min(0).max(10),
      threadCount: Schema.number().default(4).min(1).max(16),
      inputTimeout: Schema.number().default(60000).min(5000),
    }),
    Schema.object({}),
  ]),
  Schema.object({
    rpc: Schema.boolean().default(false),
  }),
  Schema.union([
    Schema.object({
      rpc: Schema.const(true).required(),
      rpcIp: Schema.string().required(),
      rpcPort: Schema.number().default(6800).min(1).max(65535),
      rpcSecure: Schema.boolean().default(false),
      rpcSecret: Schema.string(),
      rpcPolling: Schema.number().default(10000).min(1000),
      rpcPollingCount: Schema.number().default(60).min(1),
      rpcDir: Schema.string().required(),
    }),
    Schema.object({}),
  ]),
]).i18n({
  "zh-CN": require("./locales/zh-CN")._config,
  "en-US": require("./locales/en-US")._config,
});

export const inject = {
  required: ["http", "logger"],
};

export let http: HTTP;
export let logger: Logger;
export let retryCount: number;

export function apply(ctx: Context, config: Config) {
  // write your plugin here
  ctx.i18n.define("en-US", require("./locales/en-US"));
  ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

  const regexp =
    /^https:\/\/steamcommunity.com\/(sharedfiles|workshop)\/filedetails\/\?id=\d+/;

  logger = ctx.logger("wahaha216-steam-workshop");
  http = ctx.http;
  retryCount = config.requestRetries;

  ctx
    .command("workshop <url:string>")
    .option("download", "-d")
    .option("info", "-i")
    .option("name", "-n [name:string]")
    .action(async ({ session, options }, url) => {
      const id = session.messageId;
      const formatFileName = (item: FileInfo) => {
        if (options.name) return options.name;
        const invalidReg = /[\\/:\*\?"\<\>\|\r\n]/g;
        const ext = item.filename.substring(item.filename.lastIndexOf("."));
        const name = item.title.replace(invalidReg, " ");
        const download_name = `${name.trim()}${ext}`;
        logger.info(
          session.text(".download_info", [download_name, item.file_url])
        );
        return download_name;
      };

      const rpcRequest = async <T = Aria2Respond>(
        method: "aria2.addUri" | "aria2.tellStatus",
        params: Aria2Params
      ) => {
        const protocol = config.rpcSecure ? "https://" : "http://";
        const url = `${protocol}${config.rpcIp}:${config.rpcPort}/jsonrpc`;
        return await requestWithRetry<T>(url, "POST", {
          data: {
            //消息id，aria2会原样返回这个id，可以自动生成也可以用其他唯一标识
            id: new Date().getTime().toString(),
            //固定值
            jsonrpc: "2.0",
            //方法名，具体参考上方“方法列表”链接，本例中为“添加下载任务”
            method,
            //params为数组
            params,
          },
        });
      };

      const rpcServer = async (url: string, fileName: string) => {
        const token = `token:${config.rpcSecret}`;
        const addTaskParams: Aria2Params = [
          token,
          [url],
          { dir: config.rpcDir, out: fileName },
        ];
        if (!config.rpcSecret) addTaskParams.shift();
        const addTaskRes = await rpcRequest("aria2.addUri", addTaskParams);
        await session.send([
          h.quote(id),
          h.text(session.text("rpc.push", [fileName])),
        ]);
        const key = addTaskRes.result;

        let intervalCount = 0;
        do {
          await ctx.sleep(config.rpcPolling);
          try {
            const statusParams: Aria2Params = [token, key];
            if (!config.rpcSecret) statusParams.shift();
            const statusRes = await rpcRequest<Aria2Respond<Aria2TellStatus>>(
              "aria2.tellStatus",
              statusParams
            );

            switch (statusRes.result.status) {
              case "complete":
                return await session.send([
                  h.quote(id),
                  h.text(session.text("rpc.complete", [fileName])),
                ]);
              case "error":
                return await session.send([
                  h.quote(id),
                  h.text(session.text("rpc.error", [fileName])),
                ]);
              default:
                break;
            }
          } catch (error) {}
          intervalCount++;
        } while (intervalCount < config.rpcPollingCount);
        return await session.send([
          h.quote(id),
          h.text(session.text("rpc.timeout", [fileName])),
        ]);
      };

      if (regexp.test(url)) {
        const u = new URL(url);
        const workId = u.searchParams.get("id");

        const res = await requestWithRetry<FileInfo[]>(WORKSHOP_API, "POST", {
          data: `[${workId}]`,
          responseType: "json",
        });

        const data = res[0];
        if (data.num_children === 0) {
          // 单文件
          logger.info(session.text(".single_file", [data.title]));
          const fragment: h.Fragment = [
            h.quote(id),
            h.text(`${session.text(".title")}: ${data.title}\n`),
            h.text(
              `${session.text(".releaseTime")}: ${timestampToDate(
                data.time_created * 1000
              )}\n`
            ),
            h.text(
              `${session.text(".updateTime")}: ${timestampToDate(
                data.time_updated * 1000
              )}\n`
            ),
            h.text(
              `${session.text(".fileSize")}: ${sizeFormat(data.file_size)}\n`
            ),
            h.text(`${session.text(".game")}: ${data.app_name}\n`),
            h.text(
              `${session.text(".description")}: \n${data.file_description}\n`
            ),
            h.image(data.preview_url),
          ];
          if (config.askDownload && !options.info && !options.download) {
            fragment.push(
              h.text("=".repeat(20) + "\n"),
              h.text(
                session.text(".ask_download", [
                  data.title,
                  config.inputTimeout / 1000,
                ])
              )
            );
          }
          await session.send(fragment);
          // 如果只获取信息，则跳过后续询问
          if (options.info) return;

          if (config.askDownload) {
            if (!options.download) {
              const download = await session.prompt(config.inputTimeout);
              if (!download)
                return [h.quote(id), h.text(session.text(".input_timeout"))];
              if (!["是", "y", "yes"].includes(download.toLocaleLowerCase()))
                return;
            }
            const title = formatFileName(data);
            const retries = config.downloadRetries;
            let success = true;
            for (let i = 0; i <= retries; i++) {
              const result = await session.send([
                h.file(data.file_url, { title }),
              ]);
              rpcServer(data.file_url, title);
              if ((result as string[]).length) {
                return;
              } else if (i === retries - 1) {
                success = false;
              } else {
                logger.info(
                  session.text(".download_retry", [title, i + 1, retries])
                );
              }
            }
            if (!success) {
              session.send([
                h.quote(id),
                h.text(session.text(".download_fail")),
              ]);
            }
          }
        } else {
          // 合集
          logger.info(session.text(".multi_file", [data.title]));
          let workIds = data.children.map((item) => item.publishedfileid);
          const multiRes: FileInfo[] = [];
          if (workIds.length <= 50) {
            const res = await requestWithRetry<FileInfo[]>(
              WORKSHOP_API,
              "POST",
              { data: `[${workIds.join(",")}]`, responseType: "json" }
            );
            multiRes.push(...res);
          } else {
            do {
              const ids = workIds.slice(0, 50).join(",");
              const res = await requestWithRetry<FileInfo[]>(
                WORKSHOP_API,
                "POST",
                { data: `[${ids}]`, responseType: "json" }
              );
              multiRes.push(...res);
              workIds.splice(0, 50);
            } while (workIds.length <= 50);
          }
          if (!status) {
            session.send([h.quote(id), h.text(session.text(".request_fail"))]);
            return;
          }
          if (multiRes) {
            const result = segment("figure");
            const buildContent = (item: FileInfo) => {
              const fragment: h.Fragment = [
                h.text(`${session.text(".title")}: ${item.title}\n`),
                h.text(
                  `${session.text(".fileSize")}: ${sizeFormat(
                    item.file_size
                  )}\n`
                ),
                h.text(`${session.text(".game")}: ${item.app_name}\n`),
                h.text(
                  `${session.text(".description")}: \n${
                    item.file_description
                  }\n`
                ),
                h.image(item.preview_url),
              ];
              result.children.push(
                segment(
                  "message",
                  { userId: session.event.selfId, nickname: "workshop info" },
                  fragment
                )
              );
            };
            if (data.file_type === 0) {
              logger.info(session.text(".file_has_depend", [data.file_type]));
              buildContent(data);
            } else {
              logger.info(session.text(".file_collection", [data.file_type]));
            }
            multiRes.forEach(buildContent);
            await session.send(result);
            if (config.askDownload && !options.info && !options.download) {
              await sleep(2000);
              await session.send([
                h.quote(id),
                h.text(
                  session.text(".ask_download", [
                    data.title,
                    config.inputTimeout / 1000,
                  ])
                ),
              ]);
            }
            if (options.info) return;

            if (config.askDownload) {
              if (!options.download) {
                const download = await session.prompt(config.inputTimeout);
                if (!download)
                  return [h.quote(id), h.text(session.text(".input_timeout"))];
                if (!["是", "y", "yes"].includes(download.toLocaleLowerCase()))
                  return;
              }
              let success = true;
              if (data.file_type === 0) {
                multiRes.unshift(data);
              }
              let failIds = multiRes.map((item) => item.publishedfileid);
              const retries = config.downloadRetries;
              for (let i = 0; i <= retries; i++) {
                const list = multiRes.filter((item) =>
                  failIds.some((id) => id === item.publishedfileid)
                );
                for (const item of list) {
                  const title = formatFileName(item);
                  const result = await session.send([
                    h.file(item.file_url, { title }),
                  ]);
                  rpcServer(item.file_url, title);
                  if ((result as string[]).length) {
                    const index = failIds.indexOf(item.publishedfileid);
                    if (index !== -1) {
                      failIds.splice(index, 1);
                    }
                  } else if (i === retries - 1) {
                    success = false;
                  }
                }
                if (failIds.length) {
                  logger.info(
                    session.text(".download_retry", ["", i + 1, retries])
                  );
                }
              }
              if (!success) {
                session.send([
                  h.quote(id),
                  h.text(session.text(".download_fail")),
                ]);
              }
            }
          }
        }
      } else {
        session.send([h.quote(id), h.text(session.text(".invalid_link"))]);
      }
    });

  ctx.on("message", (session) => {
    if (config.autoRecognise) {
      const text = session.content;
      if (regexp.test(text)) {
        session.execute(`workshop ${text}`);
      }
    }
  });
}
