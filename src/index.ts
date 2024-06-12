import { Context, Schema, h } from "koishi";
import { FileInfo } from "./types";
import { sizeFormat } from "./utils/sizeFormat";
import {} from "@koishijs/plugin-logger";
import {} from "@koishijs/plugin-http";
import path from "path";
import fs from "fs/promises";
import { pathToFileURL } from "url";

export const name = "steam-workshop";

export interface Config {
  autoRecognise?: boolean;
  askDownload?: boolean;
}

export const Config: Schema<Config> = Schema.object({
  autoRecognise: Schema.boolean()
    .description("自动识别创意工坊链接")
    .default(true),
  askDownload: Schema.boolean().description("询问是否下载文件").default(true),
});

export const inject = {
  required: ["http", "logger"],
};

export function apply(ctx: Context, config: Config) {
  // write your plugin here
  const regexp =
    /^https:\/\/steamcommunity.com\/sharedfiles\/filedetails\/\?id=\d+/;
  const logger = ctx.logger("wahaha216-steam-workshop");
  ctx
    .command("workshop <url:string>", "识别创意工坊物品链接")
    .action(async ({ session }, url) => {
      const id = session.messageId;
      if (regexp.test(url)) {
        const workId = url.split("id=")[1];
        const res = await ctx.http
          .post<FileInfo[]>(
            "https://db.steamworkshopdownloader.io/prod/api/details/file",
            `[${workId}]`,
            { responseType: "json" }
          )
          .catch(logger.error);
        if (res) {
          const data = res[0];
          await session.send([
            h.quote(id),
            h.text(`标题：${data.title}`),
            h.text(`文件大小：${sizeFormat(data.file_size)}`),
            h.text(`游戏：${data.app_name}`),
            h.text(`描述：${data.file_description}`),
            h.image(data.preview_url),
          ]);
          if (!config.askDownload) return;
          await session.send([
            h.quote(id),
            h.text(
              `是否下载：${data.title} ？（10秒内回复：是|y|yes/否|n|no）`
            ),
          ]);
          const download = await session.prompt(10000);
          if (!download) return [h.quote(id), h.text("输入超时")];
          if (["是", "y", "yes"].includes(download.toLocaleLowerCase())) {
            const file = await ctx.http.get(data.file_url, {
              responseType: "arraybuffer",
            });
            const root = path.join(ctx.baseDir, "temp", name);
            await fs.mkdir(root, { recursive: true });
            const fileFullPath = `${root}/${data.filename}`;
            await fs.writeFile(fileFullPath, Buffer.from(file));
            await session.send([h.file(pathToFileURL(fileFullPath).href)]);
          }
        }
      } else {
        session.send([h.quote(id), h.text("不正确的链接格式")]);
      }
    });

  ctx.on("message", (session) => {
    if (config.autoRecognise) {
      const text = session.content;
      if (regexp.test(text)) {
        const cmd = text.replace(/connect/i, "workshop");
        session.execute(cmd);
      }
    }
  });
}
