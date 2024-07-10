import { Context, Schema, h, segment, sleep } from "koishi";
import { FileInfo } from "./types";
import { sizeFormat } from "./utils/sizeFormat";
import {} from "@koishijs/plugin-logger";
import {} from "@koishijs/plugin-http";
import {} from "koishi-plugin-adapter-onebot";

export const name = "steam-workshop";

export interface Config {
  autoRecognise?: boolean;
  askDownload?: boolean;
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

  // 单个文件
  const regexp =
    /^https:\/\/steamcommunity.com\/(sharedfiles|workshop)\/filedetails\/\?id=\d+/;
  const logger = ctx.logger("wahaha216-steam-workshop");
  ctx
    .command("workshop <url:string>")
    .option("download", "-d")
    .option("info", "-i")
    .action(async ({ session, options }, url) => {
      /**
       * 上传文件
       * @param url 文件网络地址
       * @param filename 文件名
       */
      const uploadFile = async (item: FileInfo) => {
        const invalidReg = /[\\/:\*\?"\<\>\|]/g;
        const ext = item.filename.substring(item.filename.lastIndexOf("."));
        const download_name = `${item.title.replace(invalidReg, " ")}${ext}`;
        logger.info(
          session.text(".download_info", [download_name, item.file_url])
        );
        // 因直接使用 h.file 无法上传文件，所以直接访问内部api
        // 至少我测试时无法上传
        if (session.bot.platform === "onebot") {
          const path = await session.onebot.downloadFile(
            item.file_url,
            undefined,
            config.threadCount
          );
          if (session.guild) {
            const gid = session.event.guild.id;
            await session.onebot
              .uploadGroupFile(gid, path, download_name)
              .catch(logger.error);
          } else {
            const uid = session.event.user.id;
            await session.onebot
              .uploadPrivateFile(uid, path, download_name)
              .catch(logger.error);
          }
        } else {
          await session.send([h.file(item.file_url)]);
        }
      };

      const id = session.messageId;
      if (regexp.test(url)) {
        const u = new URL(url);
        const workId = u.searchParams.get("id");
        const res = await ctx.http
          .post<FileInfo[]>(
            "https://db.steamworkshopdownloader.io/prod/api/details/file",
            `[${workId}]`,
            { responseType: "json" }
          )
          .catch(logger.error);

        if (!res) return;
        const data = res[0];
        if (data.num_children === 0) {
          logger.info(session.text(".single_file", [data.title]));
          const fragment: h.Fragment = [
            h.quote(id),
            h.text(`${session.text(".title")}: ${data.title}\n`),
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
            await uploadFile(data);
          }
        } else {
          // 合集
          logger.info(session.text(".multi_file", [data.title]));
          const workIds = data.children.map((item) => item.publishedfileid);
          const m_res = await ctx.http
            .post<FileInfo[]>(
              "https://db.steamworkshopdownloader.io/prod/api/details/file",
              `[${workIds.join(",")}]`,
              { responseType: "json" }
            )
            .catch(logger.error);
          if (m_res) {
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
            m_res.forEach(buildContent);
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
              if (data.file_type === 0) {
                await uploadFile(data);
              }
              for (const item of m_res) {
                await uploadFile(item);
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
