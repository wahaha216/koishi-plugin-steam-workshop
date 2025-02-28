import { Context, Schema, h, segment, sleep } from "koishi";
import { FileInfo } from "./types";
import { sizeFormat, timestampToDate } from "./utils/sizeFormat";
import {} from "@koishijs/plugin-logger";
import {} from "@koishijs/plugin-http";
import {} from "koishi-plugin-adapter-onebot";

export const name = "steam-workshop";

const WORKSHOP_API = "https://steamworkshopdownloader.io/api/details/file";

export interface Config {
  autoRecognise?: boolean;
  askDownload?: boolean;
  requestRetries?: number;
  downloadRetries?: number;
  threadCount?: number;
  inputTimeout?: number;
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
]).i18n({
  "zh-CN": require("./locales/zh-CN")._config,
  "en-US": require("./locales/en-US")._config,
});

export const inject = {
  required: ["http", "logger"],
};

export function apply(ctx: Context, config: Config) {
  // write your plugin here
  ctx.i18n.define("en-US", require("./locales/en-US"));
  ctx.i18n.define("zh-CN", require("./locales/zh-CN"));

  const regexp =
    /^https:\/\/steamcommunity.com\/(sharedfiles|workshop)\/filedetails\/\?id=\d+/;
  const logger = ctx.logger("wahaha216-steam-workshop");
  ctx
    .command("workshop <url:string>")
    .option("download", "-d")
    .option("info", "-i")
    .option("name", "-n [name:string]")
    .action(async ({ session, options }, url) => {
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

      const id = session.messageId;
      if (regexp.test(url)) {
        const u = new URL(url);
        const workId = u.searchParams.get("id");

        let res: FileInfo[];
        let error: Error;
        for (let i = 1; i <= config.requestRetries && !res?.length; i++) {
          await ctx.http
            .post<FileInfo[]>(WORKSHOP_API, `[${workId}]`, {
              responseType: "json",
            })
            .then((r) => {
              res = r;
              error = null;
            })
            .catch((err) => {
              const retries = config.requestRetries;
              logger.info(session.text(".request_retry", [i, retries]));
              error = err;
            });
        }
        error && logger.error(error);

        if (!res) return;
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
          let status = true;
          if (workIds.length <= 50) {
            const res = await ctx.http
              .post<FileInfo[]>(WORKSHOP_API, `[${workIds.join(",")}]`, {
                responseType: "json",
              })
              .catch((err) => {
                logger.error(err);
                status = false;
              });
            if (res) {
              multiRes.push(...res);
            }
          } else {
            do {
              const ids = workIds.slice(0, 50).join(",");
              const res = await ctx.http
                .post<FileInfo[]>(WORKSHOP_API, `[${ids}]`, {
                  responseType: "json",
                })
                .catch((err) => {
                  logger.error(err);
                  status = false;
                });
              if (res) {
                multiRes.push(...res);
              }
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
