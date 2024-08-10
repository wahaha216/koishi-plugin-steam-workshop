# @wahaha216/koishi-plugin-steam-workshop

[![npm](https://img.shields.io/npm/v/@wahaha216/koishi-plugin-steam-workshop?style=flat-square)](https://www.npmjs.com/package/@wahaha216/koishi-plugin-steam-workshop)

从 steam 创意工坊获取文件并上传

> 仅在 `onebot` QQ私聊与群聊中测试过，不保证其他环境能用

> onebot适配器默认60秒超时，如果下载文件时间超过60秒会导致报错

## 使用方式

```tex
单个文件
workshop https://steamcommunity.com/sharedfiles/filedetails/?id=xxxxxxxxx
合集
workshop https://steamcommunity.com/workshop/filedetails/?id=xxxxxxxxx
```

若开启自动识别则不需要指令前缀

### 可选项

`-d` 不询问直接下载
`-i` 只返回详情，不下载
若一起用则只有 `-i` 生效 
