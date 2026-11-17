# opencli-plugin-my12306train

给 [OpenCLI](https://github.com/jackwener/opencli) 用的 12306 未出行订单查询插件。

它复用你 Chrome 里已登录的 12306 会话，直接读取「火车票订单 → 未出行订单」页面，
输出每条车票的**出发地、到达地、出发时间、席别、车厢座位号、票价**，不需要额外配置 Cookie。

## 安装

```bash
# 从 GitHub 安装
opencli plugin install github:kevinhuang001/opencli-my12306train

# 本地开发（软链接，改代码立即生效）
opencli plugin install file:///absolute/path/to/opencli-my12306train
```

安装后确认：

```bash
opencli plugin list
opencli my12306train --help
```

## 命令

```bash
opencli my12306train orders
opencli my12306train orders -f table
opencli my12306train orders -f json
opencli my12306train orders -f csv
opencli my12306train orders --max-pages 0
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `--max-pages` | `5` | 最多翻多少页（12306 每页 8 个订单）；`0` 表示一直翻到最后一页，上限 20 页 |

输出字段：

| 字段 | 说明 |
| --- | --- |
| `train_code` | 车次，例如 `V1009` |
| `from_station` | 出发地（车站名） |
| `to_station` | 到达地（车站名） |
| `departure_time` | 出发时间，格式 `YYYY-MM-DD HH:mm` |
| `seat_type` | 席别，例如 `硬座`、`二等座`、`硬卧` |
| `seat_no` | 车厢座位号，例如 `11车070号` |
| `price` | 票价，单位：元 |

## 示例输出

```json
{
  "train_code": "V1009",
  "from_station": "哈尔滨东",
  "to_station": "绥化",
  "departure_time": "2026-12-01 03:19",
  "seat_type": "硬座",
  "seat_no": "11车070号",
  "price": "19.5"
}
```

```bash
$ opencli my12306train orders -f table

  my12306train/orders
┌────────────┬──────────────┬────────────┬──────────────────┬───────────┬───────────┬───────┐
│ Train_code │ From_station │ To_station │ Departure_time   │ Seat_type │ Seat_no   │ Price │
├────────────┼──────────────┼────────────┼──────────────────┼───────────┼───────────┼───────┤
│ V1009      │ 哈尔滨东     │ 绥化       │ 2026-12-01 03:19 │ 硬座      │ 11车070号 │ 19.5  │
└────────────┴──────────────┴────────────┴──────────────────┴───────────┴───────────┴───────┘
```

## 工作原理

1. 在已登录的浏览器里打开
   `https://kyfw.12306.cn/otn/view/train_order.html?type=2`，页面会自动切到「未出行订单」。
2. 等待 `table.order-item-table` 渲染完成。
3. 12306 的自动查询偶尔会输给页面脚本的初始化竞态（页面已经显示查询表单，但没有发出
   `queryMyOrder` 请求）。插件检测到这种情况会主动触发一次「查询」按钮；仍失败时整页重试一次。
4. 解析每个订单表：
   - 出发地 / 到达地 / 车次：优先读「退票」按钮上的 `data-*` 属性，缺失时解析标题
     `哈尔滨东<i class="icon icon-to"></i>绥化 V1009`；
   - 出发时间：读 `data-start-train-date-page`，缺失时从「2026-12-01 03:19 开」解析；
   - 席别 / 车厢座位号 / 票价：读每名旅客所在行的席位单元格（两个 div）与 `.txt-price`。
5. 同一订单有多名旅客时，左侧行程单元格带 `rowspan`，插件按「表」继承行程信息，
   逐个旅客行输出一条记录。
6. 有分页时点击「下一页」，直到最后一页或达到 `--max-pages`。

## 前置条件

- Node.js >= 20
- OpenCLI >= 2.0.0
- Chrome 已安装并连接 OpenCLI Browser Bridge
- Chrome 中已登录 12306

## 文件结构

```text
opencli-my12306train/
├── opencli-plugin.json   # 插件清单
├── package.json
├── orders.js             # my12306train orders
├── README.md
└── LICENSE
```

## License

MIT
