import { Context, Schema, h } from "koishi";
import { FileInfo } from "./types";
import { sizeFormat } from "./utils/sizeFormat";
import {} from "@koishijs/plugin-logger";
import {} from "@koishijs/plugin-http";
import {} from "koishi-plugin-adapter-onebot";

export const name = "steam-workshop";

export interface Config {
  autoRecognise?: boolean;
  askDownload?: boolean;
  inputTimeout?: number;
}

export const Config: Schema<Config> = Schema.object({
  autoRecognise: Schema.boolean().default(true),
  askDownload: Schema.boolean().default(true),
  inputTimeout: Schema.number().default(10000).min(1000),
}).i18n({
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
    /^https:\/\/steamcommunity.com\/sharedfiles\/filedetails\/\?id=\d+/;
  const logger = ctx.logger("wahaha216-steam-workshop");
  ctx.command("workshop <url:string>").action(async ({ session }, url) => {
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

      if (res) {
        const data = res[0];
        const fragment: h.Fragment = [
          h.quote(id),
          h.text(`${session.text(".title")}: ${data.title}\n`),
          h.text(
            `${session.text(".fileSize")}: ${sizeFormat(data.file_size)}\n`
          ),
          h.text(`${session.text(".game")}: ${data.app_name}\n`),
          h.text(`${session.text(".description")}: ${data.file_description}\n`),
          h.image(data.preview_url),
        ];
        if (config.askDownload) {
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

        const download = await session.prompt(10000);
        if (!download)
          return [h.quote(id), h.text(session.text(".input_timeout"))];
        if (["是", "y", "yes"].includes(download.toLocaleLowerCase())) {
          // 因直接使用 h.file 无法上传文件，所以直接访问内部api
          // 至少我测试时无法上传
          if (session.bot.platform === "onebot") {
            const path = await session.onebot.downloadFile(data.file_url);
            const invalidReg = /[\\/:\*\?"\<\>\|]/g;
            const ext = data.filename.substring(data.filename.lastIndexOf("."));
            const filename = `${data.title.replace(invalidReg, " ")}${ext}`;
            if (session.guild) {
              const gid = session.event.guild.id;
              await session.onebot
                .uploadGroupFile(gid, path, filename)
                .catch(logger.error);
            } else {
              const uid = session.event.user.id;
              await session.onebot
                .uploadPrivateFile(uid, path, filename)
                .catch(logger.error);
            }
          } else {
            await session.send([h.file(data.file_url)]);
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
