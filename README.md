# nas-control

通过网页控制 NAS：关闭/打开本地显示器，以及按设定时间每日自动关机。

## 功能

- 屏幕
  - **关闭屏幕** → `setterm --blank force --term linux </dev/tty1`
  - **打开屏幕** → `setterm --blank poke --term linux </dev/tty1`
- 定时关机
  - 可自由设定每天关机时间（例如 `03:00`）
  - 配置写入 `schedule.json`，重启后自动加载
  - 服务启动时会计算下一次关机时间并继续调度
  - 到点执行 `shutdown -h now`
- 开机由 BIOS 自动上电，本服务负责关机侧

## 运行（需 root）

`setterm` / `shutdown` 需要 root，服务本身也要以 root 启动。

```bash
# 临时跑
sudo node server.js

# 飞牛 / pm2 常驻（开机自启）
sudo pm2 start server.js --name nas-control
sudo pm2 save
sudo pm2 startup   # 按提示执行输出的那条命令
```

默认监听 `http://0.0.0.0:3000`。

### 开机自动恢复定时关机

1. `pm2 startup` 保证进程开机自启
2. 服务启动时读取 `schedule.json`
3. 自动算出下一次关机时间并挂上定时器

所以：BIOS 定时开机 → 系统起来 → pm2 拉起本服务 → 服务继续负责到点关机。

## 页面用法

1. 打开 `http://<NAS-IP>:3000`
2. 在「定时关机」里选时间（默认 `03:00`）
3. 勾选「启用定时关机」
4. 点「保存计划」

页面会显示下次关机时间。

## 配置文件

`schedule.json` 示例：

```json
{
  "enabled": true,
  "time": "03:00"
}
```

该文件由服务写入，已加入 `.gitignore`。

可选环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP 端口 |
| `NAS_TTY` | `/dev/tty1` | 目标控制台设备 |

## 安全说明

服务端只执行固定命令（屏幕开关 + 定时关机），**不接受任意命令输入**。请勿把该服务直接暴露到公网；建议仅在局域网访问。

## 项目结构

```
nas-control/
├── server.js          # HTTP 服务 + 定时关机调度
├── package.json
├── schedule.json      # 运行时生成，保存关机计划
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── README.md
```
