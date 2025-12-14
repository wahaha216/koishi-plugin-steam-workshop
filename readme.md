# @wahaha216/koishi-plugin-steam-workshop

[![npm](https://img.shields.io/npm/v/@wahaha216/koishi-plugin-steam-workshop?style=flat-square)](https://www.npmjs.com/package/@wahaha216/koishi-plugin-steam-workshop)

从 steam 创意工坊获取文件并上传，可选 RPC 推送至服务器下载

> 仅在 `onebot` QQ 私聊与群聊中测试过，不保证其他环境能用

> onebot 适配器默认 60 秒超时，如果下载文件时间超过 60 秒会导致报错

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
`-n` 指定下载文件名，包括扩展名

## 更新日志

<details>
<summary>1.0.0-rc.6</summary>
1.当获取的信息为空时提示错误信息，而不是继续往下执行

2.修改RPC的文本

</details>

<details>
<summary>1.0.0-rc.5</summary>
修正类型为单文件时无法RPC推送至服务器
</details>

<details>
<summary>1.0.0-rc.4</summary>
重构部分代码
</details>

<details>
<summary>1.0.0-rc.3</summary>
1.未启用rpc不会询问是否推送

2.返回远程服务器解析失败信息

</details>
