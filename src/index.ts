import { Context, Schema, h, segment, sleep } from "koishi";
import { Aria2Respond, Aria2TellStatus, RpcBody } from "./types/Aria2";
import {} from "@koishijs/plugin-logger";
import {} from "@koishijs/plugin-http";
import { formatFileName, requestWithRetry } from "./utils";
import { OverRetryError } from "./error/overRetry.error";
import { SteamWorkshop } from "./entity/SteamWorkshop";

export const name = "steam-workshop";

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
    .option("push", "-p")
    .action(async ({ session, options }, url) => {
      const id = session.messageId;
      const timeout = config.inputTimeout / 1000;

      const rpcRequest = async <T = Aria2Respond>(body: RpcBody) => {
        const protocol = config.rpcSecure ? "https://" : "http://";
        const url = `${protocol}${config.rpcIp}:${config.rpcPort}/jsonrpc`;
        return await requestWithRetry<T>(
          ctx.http,
          logger,
          config.requestRetries,
          url,
          "POST",
          { data: body }
        );
      };

      const rpcServer = async (steamWorkshop: SteamWorkshop) => {
        const rpcDownloadBody = steamWorkshop.buildRpcDownloadBody();
        const addTaskRes = await rpcRequest(rpcDownloadBody);
        await session.send([h.quote(id), h.text(session.text("rpc.push"))]);
        const result = addTaskRes.result;
        const keys = result.map((r) => r[0]);

        let intervalCount = 0;
        do {
          await ctx.sleep(config.rpcPolling);
          try {
            const rpcStatusBody = steamWorkshop.buildRpcStatusBody(keys);

            const statusRes = await rpcRequest<
              Aria2Respond<Aria2TellStatus[][]>
            >(rpcStatusBody);

            const status = statusRes.result.map((item) => item[0].status);

            const success = status.every((item) => item === "complete");
            if (success) {
              return await session.send([
                h.quote(id),
                h.text(session.text("rpc.complete")),
              ]);
            }

            const someError = status.some((item) => item === "error");
            if (someError) {
              const errorMsg = statusRes.result.map(
                (item) => item[0].errorMessage
              );
              return await session.send([
                h.quote(id),
                h.text(session.text("rpc.error", [errorMsg[0]])),
              ]);
            }
          } catch (error) {}
          intervalCount++;
        } while (intervalCount < config.rpcPollingCount);
        return await session.send([
          h.quote(id),
          h.text(session.text("rpc.timeout")),
        ]);
      };

      if (regexp.test(url)) {
        const steamWorkshop = new SteamWorkshop(
          session,
          ctx.http,
          logger,
          config
        );
        try {
          await steamWorkshop.analyzeUrl(url);
        } catch (error) {
          if (error instanceof OverRetryError) {
            session.send([h.quote(id), h.text(session.text(".request_fail"))]);
            return;
          }
        }
        const singleFile = steamWorkshop.getSingleFile();

        // 单文件
        if (singleFile) {
          const fileInfos = steamWorkshop.getFileInfos();
          const fileinfo = fileInfos[0];
          const title = steamWorkshop.getTitle();
          logger.info(session.text(".single_file", [title]));
          const fragment: h.Fragment = [
            h.quote(id),
            h.text(`${session.text(".title")}: ${fileinfo.title}\n`),
            h.text(
              `${session.text(".releaseTime")}: ${fileinfo.releaseTime}\n`
            ),
            h.text(`${session.text(".updateTime")}: ${fileinfo.updateTime}\n`),
            h.text(
              `${session.text(".fileSize")}: ${fileinfo.formatFileSize}\n`
            ),
            h.text(`${session.text(".game")}: ${fileinfo.game}\n`),
            h.text(
              `${session.text(".description")}: \n${fileinfo.description}\n`
            ),
            h.image(fileinfo.imageUrl),
          ];
          if (config.askDownload && !options.info && !options.download) {
            fragment.push(
              h.text("=".repeat(20) + "\n"),
              h.text(session.text(".ask_download", [fileinfo.title, timeout]))
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
            let push = options.push || false;
            if (config.rpc && !options.push) {
              await session.send([
                h.quote(id),
                h.text(session.text(".ask_push"), [timeout]),
              ]);
              const ans = await session.prompt(config.inputTimeout);
              push = ["是", "y", "yes"].includes(ans.toLocaleLowerCase());
            }
            const retries = config.downloadRetries;
            let success = true;
            for (let i = 0; i <= retries; i++) {
              const result = await session.send([
                h.file(fileinfo.fileUrl, { title: fileinfo.fileName }),
              ]);
              if ((result as string[]).length) {
                return;
              } else if (i === retries - 1) {
                success = false;
              } else {
                logger.info(
                  session.text(".download_retry", [
                    fileinfo.fileName,
                    i + 1,
                    retries,
                  ])
                );
              }
            }
            if (!success) {
              session.send([
                h.quote(id),
                h.text(session.text(".download_fail")),
              ]);
            }
            if (config.rpc && push) rpcServer(steamWorkshop);
          }
        }
        // 合集
        else {
          const title = steamWorkshop.getTitle();
          logger.info(session.text(".multi_file", [title]));
          const workshopInfo = steamWorkshop.getWorkshopInfo();
          const workshopFileinfo = steamWorkshop.getFileInfos();
          const fileType = workshopInfo[0].file_type;
          if (fileType === 0) {
            logger.info(session.text(".file_has_depend", [fileType]));
          } else {
            logger.info(session.text(".file_collection", [fileType]));
            workshopInfo.shift();
            workshopFileinfo.shift();
          }
          const result = segment("figure");
          workshopFileinfo.forEach((item) => {
            const fragment: h.Fragment = [
              h.text(`${session.text(".title")}: ${item.title}\n`),
              h.text(`${session.text(".fileSize")}: ${item.fileSize}\n`),
              h.text(`${session.text(".releaseTime")}: ${item.releaseTime}\n`),
              h.text(`${session.text(".updateTime")}: ${item.updateTime}\n`),
              h.text(`${session.text(".game")}: ${item.game}\n`),
              h.text(
                `${session.text(".description")}: \n${item.description}\n`
              ),
              h.image(item.imageUrl),
            ];
            result.children.push(
              segment(
                "message",
                { userId: session.event.selfId, nickname: "workshop info" },
                fragment
              )
            );
          });
          await session.send(result);
          if (config.askDownload && !options.info && !options.download) {
            await sleep(2000);
            await session.send([
              h.quote(id),
              h.text(session.text(".ask_download", [title, timeout])),
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
            let push = options.push || false;
            if (config.rpc && !options.push) {
              await session.send([
                h.quote(id),
                h.text(session.text(".ask_push"), [timeout]),
              ]);
              const ans = await session.prompt(config.inputTimeout);
              push = ["是", "y", "yes"].includes(ans.toLocaleLowerCase());
            }
            let success = true;
            let failIds = workshopInfo.map((item) => item.publishedfileid);
            const retries = config.downloadRetries;
            for (let i = 0; i <= retries; i++) {
              const list = workshopInfo.filter((item) =>
                failIds.some((id) => id === item.publishedfileid)
              );
              for (const item of list) {
                const title = formatFileName(logger, item, session);
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
            if (config.rpc && push) rpcServer(steamWorkshop);
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
