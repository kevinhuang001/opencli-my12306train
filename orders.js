/**
 * 12306 未出行订单。
 *
 * 打开 https://kyfw.12306.cn/otn/view/train_order.html?type=2 后，页面会自动
 * 切到「未出行订单」并查询，订单以 table.order-item-table 渲染。每个订单
 * 表可能包含多名旅客（后续行通过 rowspan 共用出发地 / 到达地 / 出发时间），
 * 因此解析时按表继承「行程」信息，再逐个旅客行读取席别与票价。
 *
 * 输出字段：车次、出发地、到达地、出发时间、席别、车厢座位号、票价。
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const ORDERS_URL = 'https://kyfw.12306.cn/otn/view/train_order.html?type=2';

export const ORDERS_COLUMNS = [
  'train_code',
  'from_station',
  'to_station',
  'departure_time',
  'seat_type',
  'seat_no',
  'price',
];

/**
 * 在 12306 页面内执行：等待「未出行订单」渲染完成后提取订单行。
 * 该函数会被 Function#toString 序列化后注入浏览器，必须保持自包含。
 */
export function readPendingOrders(maxPages) {
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const pageLimit = maxPages > 0 ? maxPages : 20;

  const isLoginPage = () =>
    /\/login\.html|\/otn\/login\b|passport\.12306\.cn/.test(location.href)
    || Boolean(document.querySelector('#loginForm, .login-box'));

  const isVisible = node => Boolean(node && (node.offsetWidth || node.offsetHeight || node.getClientRects().length));

  // 只取「未出行订单」中当前可见的订单表。页面里还藏着未完成订单表和每个
  // 订单下方的操作菜单表，前者不可见，后者没有 .order-info-ticket。
  const orderTables = () => [...document.querySelectorAll('table.order-item-table')]
    .filter(table => isVisible(table) && table.querySelector('.order-info-ticket'));

  const onPendingTab = () => {
    const tab = document.querySelector('#order_tab li.active');
    return !tab || /未出行/.test(tab.innerText);
  };

  const firstOrderId = () => orderTables()[0]?.id || '';

  function parseTrip(info, row) {
    const link = row.querySelector('a.tuipiao');
    let from = clean(link?.dataset.fromStationName);
    let to = clean(link?.dataset.toStationName);
    let trainCode = clean(link?.dataset.trainCode);
    let departure = clean(link?.dataset.startTrainDatePage);

    // 页面标题形如「哈尔滨东<i class="icon icon-to"></i>绥化 V1009」。
    const title = info.querySelector('.txt-bold');
    if (title) {
      const icon = title.querySelector('i.icon-to, .icon-to');
      const nodes = [...title.childNodes];
      if (icon) {
        const index = nodes.indexOf(icon);
        from ||= clean(nodes.slice(0, index).map(node => node.textContent).join(''));
        const tail = clean(nodes.slice(index + 1).map(node => node.textContent).join(''));
        const match = tail.match(/^(.*?)\s*([A-Z]\d{1,4})$/);
        to ||= match ? clean(match[1]) : tail;
        trainCode ||= match ? match[2] : '';
      }
    }

    if (!departure) {
      const dateText = clean(
        [...info.children]
          .filter(node => !node.classList.contains('txt-bold'))
          .map(node => node.textContent)
          .join(' '),
      );
      const match = dateText.match(/(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/);
      if (match) departure = match[1] + ' ' + match[2];
    }

    return { from, to, trainCode, departure };
  }

  function readCurrentPage() {
    const rows = [];

    for (const table of orderTables()) {
      let trip = null;

      for (const row of table.querySelectorAll('tbody tr')) {
        const info = row.querySelector('.order-info-ticket');
        if (info) trip = parseTrip(info, row);
        if (!trip) continue;

        const passengerCell = row.querySelector('.passenger-operation')?.closest('td');
        if (!passengerCell) continue;

        // 同一订单的多名旅客共用左侧行程单元格（rowspan），因此席位单元格
        // 紧跟在旅客单元格后面，而不能写死第 3 个 td。
        const seatCell = passengerCell.nextElementSibling;
        if (!seatCell) continue;

        const priceText = clean(row.querySelector('.txt-price')?.textContent);
        if (!priceText) continue;

        const link = row.querySelector('a.tuipiao');
        // 席位单元格通常有两个 div：席别（硬座）和车厢座位号（11车070号）。
        const seatCells = [...seatCell.querySelectorAll(':scope > div')]
          .map(node => clean(node.textContent))
          .filter(Boolean);
        const seatType = clean(link?.dataset.seatTypeName) || seatCells[0] || '';
        let seatNo = seatCells[1] || '';
        if (!seatNo && link) {
          const coach = clean(link.dataset.coachNo) || clean(link.dataset.coachName);
          const seat = clean(link.dataset.seatName) || clean(link.dataset.seatNo);
          if (coach || seat) seatNo = (coach ? coach + '车' : '') + seat;
        }
        const priceMatch = priceText.match(/[\d,]+(?:\.\d+)?/);
        const price = priceMatch ? priceMatch[0].replace(/,/g, '') : priceText;

        rows.push({
          train_code: trip.trainCode,
          from_station: trip.from,
          to_station: trip.to,
          departure_time: trip.departure,
          seat_type: seatType,
          seat_no: seatNo,
          price,
        });
      }
    }

    return rows;
  }

  async function nextPage() {
    const box = document.querySelector('#J-Trip');
    if (!box || !isVisible(box)) return false;

    const next = [...box.querySelectorAll('a')]
      .find(node => /下一页/.test(node.textContent));
    if (!next || next.classList.contains('disabled') || next.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    const before = firstOrderId();
    next.click();
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(250);
      if (firstOrderId() && firstOrderId() !== before) return true;
    }
    return false;
  }

  async function waitForState(timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (isLoginPage()) return 'auth';
      if (onPendingTab() && orderTables().length) return 'ready';
      const container = document.querySelector('#not_travel');
      if (onPendingTab() && container && /对应的订单内容|暂无|没有找到|无订单/.test(container.innerText)) {
        return 'empty';
      }
      await sleep(250);
    }
    return 'loading';
  }

  function clickQuery() {
    const button = document.querySelector('#searchNoTrip');
    if (!button) return false;
    // 12306 的自动查询偶尔会输给 requirejs 初始化竞态：表单和事件都已就绪，
    // 但首屏没有发出 queryMyOrder 请求。此时主动触发一次「查询」即可恢复。
    if (window.jQuery?._data(button, 'events')?.click) {
      window.jQuery(button).trigger('click');
    } else {
      button.click();
    }
    return true;
  }

  async function collect() {
    let state = await waitForState(4000);

    if (state === 'loading') {
      if (!onPendingTab()) {
        document.querySelector('#order_tab li[data-type="0"] a')?.click();
        await sleep(800);
      }
      if (clickQuery()) {
        state = await waitForState(5000);
        if (state === 'loading' && clickQuery()) {
          state = await waitForState(10000);
        }
      }
    }

    if (state === 'auth') return { error: 'auth-required' };
    if (state === 'empty') return { output: [] };
    if (state !== 'ready') return { error: 'orders-unavailable' };

    const output = [];
    for (let pageIndex = 0; pageIndex < pageLimit; pageIndex++) {
      output.push(...readCurrentPage());
      if (pageIndex + 1 >= pageLimit) break;
      if (!(await nextPage())) break;
    }
    return { output };
  }

  return collect();
}

export async function runPendingOrders(page, kwargs = {}) {
  const raw = kwargs['max-pages'] ?? 5;
  const maxPages = Number(raw);
  if (!Number.isInteger(maxPages) || maxPages < 0 || maxPages > 20) {
    throw new ArgumentError('max-pages must be an integer from 0 to 20');
  }

  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(ORDERS_URL);
    result = await page.evaluate(`(${readPendingOrders.toString()})(${maxPages})`);

    if (result?.error === 'auth-required') {
      throw new AuthRequiredError('12306.cn', '12306 登录已失效，请在 Chrome 中重新登录。');
    }
    if (result?.error !== 'orders-unavailable') break;
    if (attempt === 0) await page.wait(1);
  }

  if (result?.error === 'orders-unavailable') {
    throw new CommandExecutionError('读取不到 12306 未出行订单，请稍后重试。');
  }
  return Array.isArray(result?.output) ? result.output : [];
}

cli({
  site: 'my12306train',
  name: 'orders',
  access: 'read',
  description: '查询 12306 未出行订单（出发地 / 到达地 / 出发时间 / 席别 / 票价）',
  domain: 'kyfw.12306.cn',
  strategy: Strategy.COOKIE,
  args: [
    {
      name: 'max-pages',
      type: 'int',
      default: 5,
      help: '最多扫描订单页数（默认 5，0 表示扫描到最后一页，上限 20）',
    },
  ],
  columns: ORDERS_COLUMNS,
  navigateBefore: false,
  func: async (page, kwargs) => runPendingOrders(page, kwargs),
});
