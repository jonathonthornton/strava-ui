const apiBaseUrl = 'https://strava-fetcher-production.up.railway.app';
const proxyBaseUrl = '/proxy/';

const resultSummary = document.getElementById('resultSummary');
const queryList = document.getElementById('queryList');
const resultsPanel = document.getElementById('resultsPanel');
const chartPanelSection = document.getElementById('chartPanelSection');
const chartPanel = document.getElementById('chartPanel');

let queryDialog = null;
let dialogBody = null;
let closeDialogBtn = null;
let runQueryBtn = null;

const endpoints = [
  {
    title: 'Recent rides',
    description: 'Recent ride details with a count limit.',
    path: '/activities/recent/{limit}',
    inputs: [{ name: 'limit', label: 'Limit', placeholder: '10' }],
    builder: ({ limit }) => `/activities/recent/${encodeURIComponent(limit || '10')}`,
    curated: true
  },
  {
    title: 'Rides by bike since date',
    description: 'Summary of rides grouped by bike since a date.',
    path: '/activities/rides-by-bike?sinceDate={sinceDate}',
    inputs: [{ name: 'sinceDate', label: 'Since date', type: 'date', placeholder: `${new Date().getFullYear()}-01-01` }],
    builder: ({ sinceDate }) => `/activities/rides-by-bike?sinceDate=${encodeURIComponent(sinceDate || `${new Date().getFullYear()}-01-01`)}`,
    chart: { xKey: 'name', yKey: 'distance', title: 'Total distance by bike', xLabel: 'Bike', yLabel: 'Total distance (km)' }
  },
  {
    title: 'Distance range counts',
    description: 'Ride counts within distance buckets.',
    path: '/activities/distance-range-counts',
    inputs: [],
    builder: () => '/activities/distance-range-counts',
    columnOrder: ['distanceRange', 'rideCount']
  },
  {
    title: 'Earliest ride by bike',
    description: 'The earliest ride for each bike.',
    path: '/activities/earliest-ride-by-bike',
    inputs: [],
    builder: () => '/activities/earliest-ride-by-bike'
  },
  {
    title: 'Bike Odometer',
    description: 'Total distance per bike.',
    path: '/activities/odometer',
    inputs: [],
    builder: () => '/activities/odometer',
    totalRow: true,
    chart: { xKey: 'name', yKey: 'distance', title: 'Total distance by bike', xLabel: 'Bike', yLabel: 'Total distance (km)' }
  },
  {
    title: 'Long rides by bike',
    description: 'Rides of at least 200km grouped by bike.',
    path: '/activities/long-rides-by-bike',
    inputs: [],
    builder: () => '/activities/long-rides-by-bike'
  },
  {
    title: 'Long rides per year',
    description: 'Rides of at least 200km grouped by year.',
    path: '/activities/long-rides-per-year',
    inputs: [],
    builder: () => '/activities/long-rides-per-year'
  },
  {
    title: 'Eddington number',
    description: 'Greatest ride count/distance combination.',
    path: '/activities/eddington-number',
    inputs: [],
    builder: () => '/activities/eddington-number'
  },
  {
    title: 'Long rides',
    description: 'Long ride details.',
    path: '/activities/long-rides',
    inputs: [],
    builder: () => '/activities/long-rides',
    curated: true
  }
];

let selectedEndpoint = null;
let lastPayload = null;
let lastAttributeKeys = [];
let selectedAttributes = new Set();
let sortState = { key: null, direction: 'asc' };
let lastQueryEndpoint = null;
let lastQueryValues = {};

const DEFAULT_ATTRIBUTES = new Set([
  'name',
  'distance',
  'movingTime',
  'totalElevationGain',
  'climbPerKm',
  'startDateLocal',
  'sufferScore',
  'bike'
]);

function withComputedFields(payload) {
  if (!Array.isArray(payload)) return payload;
  return payload.map((row) => {
    if (row && typeof row === 'object' && typeof row.distance === 'number' && typeof row.totalElevationGain === 'number') {
      const climbPerKm = row.distance > 0 ? row.totalElevationGain / row.distance : 0;
      const result = {};
      Object.keys(row).forEach((key) => {
        result[key] = row[key];
        if (key === 'totalElevationGain') {
          result.climbPerKm = climbPerKm;
        }
      });
      return result;
    }
    return row;
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderQueryList() {
  queryList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  endpoints.forEach((endpoint) => {
    const item = document.createElement('button');
    item.className = 'query-item';
    item.type = 'button';
    item.innerHTML = `
      <div>
        <h3>${escapeHtml(endpoint.title)}</h3>
        <p>${escapeHtml(endpoint.description)}</p>
      </div>
    `;
    item.addEventListener('click', () => {
      if (endpoint.inputs.length) {
        openDialog(endpoint);
      } else {
        selectedEndpoint = endpoint;
        runSelectedQuery();
      }
    });
    fragment.appendChild(item);
  });

  queryList.appendChild(fragment);
}

function createDialog() {
  if (queryDialog) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  backdrop.hidden = true;
  backdrop.style.display = 'none';

  const dialog = document.createElement('div');
  dialog.className = 'dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'dialogTitle');

  dialog.innerHTML = `
    <div class="dialog-header">
      <h3 id="dialogTitle">Query parameters</h3>
      <button type="button" class="secondary" id="closeDialogBtn">Close</button>
    </div>
    <div id="dialogBody" class="dialog-body"></div>
    <div class="dialog-actions">
      <button type="button" class="primary" id="runQueryBtn">Run query</button>
    </div>
  `;

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  queryDialog = backdrop;
  dialogBody = dialog.querySelector('#dialogBody');
  closeDialogBtn = dialog.querySelector('#closeDialogBtn');
  runQueryBtn = dialog.querySelector('#runQueryBtn');

  closeDialogBtn.addEventListener('click', closeDialog);
  queryDialog.addEventListener('click', (event) => {
    if (event.target === queryDialog) closeDialog();
  });
  runQueryBtn.addEventListener('click', runSelectedQuery);
}

function openDialog(endpoint) {
  createDialog();
  selectedEndpoint = endpoint;
  dialogBody.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'dialog-body';
  endpoint.inputs.forEach((input) => {
    const label = document.createElement('label');
    const valueAttr = input.type === 'date' && input.placeholder ? ` value="${escapeHtml(input.placeholder)}"` : '';
    label.innerHTML = `${escapeHtml(input.label)}<input data-input="${input.name}" type="${escapeHtml(input.type || 'text')}" placeholder="${escapeHtml(input.placeholder || '')}"${valueAttr} />`;
    form.appendChild(label);
  });
  dialogBody.appendChild(form);

  queryDialog.hidden = false;
  queryDialog.style.display = 'grid';
}

function closeDialog() {
  if (queryDialog) {
    queryDialog.hidden = true;
    queryDialog.style.display = 'none';
  }
}

function getAttributeKeys(payload) {
  if (Array.isArray(payload)) {
    const keys = [];
    const seen = new Set();
    payload.forEach((row) => {
      if (row && typeof row === 'object') {
        Object.keys(row).forEach((key) => {
          if (!seen.has(key)) {
            seen.add(key);
            keys.push(key);
          }
        });
      }
    });
    return keys;
  }

  if (payload && typeof payload === 'object') {
    return Object.keys(payload);
  }

  return [];
}

function orderAttributeKeys(keys, columnOrder) {
  if (!columnOrder) return keys;
  const known = columnOrder.filter((key) => keys.includes(key));
  const extra = keys.filter((key) => !columnOrder.includes(key));
  return [...known, ...extra];
}

function formatHeaderLabel(key) {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter(Boolean);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

const SECONDS_KEYS = new Set(['movingTime', 'elapsedTime']);

function formatSecondsAsHHMM(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatCellValue(key, value, row) {
  const url = row && typeof row.url === 'string' && /^https?:\/\//i.test(row.url) ? row.url : null;

  if (key === 'name' && url) {
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`;
  }

  if (key === 'url' && typeof value === 'string' && /^https?:\/\//i.test(value)) {
    return `<a href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">${escapeHtml(value)}</a>`;
  }

  if (typeof value === 'number') {
    if (SECONDS_KEYS.has(key)) {
      return escapeHtml(formatSecondsAsHHMM(value));
    }
    if (key === 'averageSpeed') {
      return escapeHtml(value.toFixed(1));
    }
    if (key === 'year') {
      return escapeHtml(Math.round(value));
    }
    return escapeHtml(Math.round(value).toLocaleString());
  }

  return escapeHtml(value && typeof value === 'object' ? JSON.stringify(value) : value);
}

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function renderTotalRow(headers, rows) {
  let labeled = false;
  const cells = headers.map((header) => {
    const allNumeric = rows.length > 0 && rows.every((row) => typeof row[header] === 'number');
    if (allNumeric) {
      const total = rows.reduce((sum, row) => sum + row[header], 0);
      return `<td>${formatCellValue(header, total)}</td>`;
    }
    if (!labeled) {
      labeled = true;
      return '<td>Total</td>';
    }
    return '<td></td>';
  }).join('');

  return `<tfoot><tr class="total-row">${cells}</tr></tfoot>`;
}

function renderTable(payload) {
  if (Array.isArray(payload)) {
    if (!payload.length) {
      return '<p class="empty-state">No rows returned.</p>';
    }

    const headers = lastAttributeKeys.filter((key) => selectedAttributes.has(key));
    if (!headers.length) {
      return '<p class="empty-state">No attributes selected.</p>';
    }

    const rows = sortState.key && headers.includes(sortState.key)
      ? [...payload].sort((a, b) => {
        const result = compareValues(a[sortState.key], b[sortState.key]);
        return sortState.direction === 'desc' ? -result : result;
      })
      : payload;

    const totalRowHtml = lastQueryEndpoint && lastQueryEndpoint.totalRow
      ? renderTotalRow(headers, payload)
      : '';

    return `
      <div class="table-scroll">
        <table>
          <thead><tr>${headers.map((header) => {
      const isActive = sortState.key === header;
      const arrow = isActive ? (sortState.direction === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th data-sort-key="${escapeHtml(header)}" class="sortable${isActive ? ' sorted' : ''}">${escapeHtml(formatHeaderLabel(header))}${arrow}</th>`;
    }).join('')}</tr></thead>
          <tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${formatCellValue(header, row[header], row)}</td>`).join('')}</tr>`).join('')}</tbody>
          ${totalRowHtml}
        </table>
      </div>
    `;
  }

  if (payload && typeof payload === 'object') {
    const entries = Object.entries(payload).filter(([key]) => selectedAttributes.has(key));
    if (!entries.length) {
      return '<p class="empty-state">No attributes selected.</p>';
    }

    return `
      <div class="table-scroll">
        <table>
          <thead><tr><th>Field</th><th>Value</th></tr></thead>
          <tbody>${entries.map(([key, value]) => `<tr><td>${escapeHtml(formatHeaderLabel(key))}</td><td>${formatCellValue(key, value)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    `;
  }

  return `<p class="empty-state">${escapeHtml(String(payload ?? 'No data returned.'))}</p>`;
}

function computeNiceTicks(maxValue, tickCount = 5) {
  if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] };

  const niceNum = (value, round) => {
    const exponent = Math.floor(Math.log10(value));
    const fraction = value / 10 ** exponent;
    let niceFraction;
    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
    return niceFraction * 10 ** exponent;
  };

  const range = niceNum(maxValue, false);
  const step = niceNum(range / (tickCount - 1), true);
  const niceMax = Math.ceil(maxValue / step) * step;

  const ticks = [];
  for (let value = 0; value <= niceMax + step / 2; value += step) {
    ticks.push(Math.round(value * 100) / 100);
  }
  return { max: niceMax, ticks };
}

function renderBarChart(payload, chart) {
  const rows = payload
    .filter((row) => row && typeof row[chart.yKey] === 'number')
    .sort((a, b) => b[chart.yKey] - a[chart.yKey]);
  if (!rows.length) return '';

  const width = 680;
  const height = 320;
  const margin = { top: 32, right: 16, bottom: 40, left: 60 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const baselineY = margin.top + plotHeight;

  const maxValue = Math.max(...rows.map((row) => row[chart.yKey]));
  const { max: niceMax, ticks } = computeNiceTicks(maxValue);
  const yFor = (value) => margin.top + plotHeight - (value / niceMax) * plotHeight;

  const gridlines = ticks.map((tick) => {
    const y = yFor(tick);
    return `
      <line class="chart-gridline" x1="${margin.left}" x2="${margin.left + plotWidth}" y1="${y}" y2="${y}" />
      <text class="chart-axis-label" x="${margin.left - 10}" y="${y}" text-anchor="end" dominant-baseline="middle">${Math.round(tick).toLocaleString()}</text>
    `;
  }).join('');

  const bandWidth = plotWidth / rows.length;
  const barWidth = Math.min(24, bandWidth * 0.6);

  const bars = rows.map((row, index) => {
    const value = row[chart.yKey];
    const name = String(row[chart.xKey]);
    const roundedValue = Math.round(value).toLocaleString();
    const barX = margin.left + index * bandWidth + (bandWidth - barWidth) / 2;
    const barY = yFor(value);
    const barHeight = baselineY - barY;
    const radius = Math.max(0, Math.min(4, barWidth / 2, barHeight));

    const path = barHeight <= radius
      ? `M${barX},${baselineY} L${barX},${barY} L${barX + barWidth},${barY} L${barX + barWidth},${baselineY} Z`
      : `M${barX},${baselineY} L${barX},${barY + radius} Q${barX},${barY} ${barX + radius},${barY} L${barX + barWidth - radius},${barY} Q${barX + barWidth},${barY} ${barX + barWidth},${barY + radius} L${barX + barWidth},${baselineY} Z`;

    const centerX = barX + barWidth / 2;

    return `
      <g class="chart-bar-group" tabindex="0" role="img" aria-label="${escapeHtml(name)}: ${escapeHtml(roundedValue)}">
        <path class="chart-bar" d="${path}" />
        <text class="chart-value-label" x="${centerX}" y="${barY - 10}" text-anchor="middle">${roundedValue}</text>
        <text class="chart-axis-label" x="${centerX}" y="${baselineY + 18}" text-anchor="middle">${escapeHtml(name)}</text>
      </g>
    `;
  }).join('');

  return `
    <div class="chart-container">
      <p class="chart-title">${escapeHtml(chart.title || '')}</p>
      <svg class="bar-chart" viewBox="0 0 ${width} ${height}" role="group" aria-label="${escapeHtml(chart.title || '')}">
        ${gridlines}
        ${bars}
      </svg>
    </div>
  `;
}

function wireChartInteractions() {
  chartPanel.querySelectorAll('.chart-bar-group').forEach((group) => {
    group.addEventListener('pointerenter', () => group.classList.add('hovered'));
    group.addEventListener('pointerleave', () => group.classList.remove('hovered'));
    group.addEventListener('focus', () => group.classList.add('hovered'));
    group.addEventListener('blur', () => group.classList.remove('hovered'));
  });
}

function renderQueryInfo(endpoint, values) {
  if (!endpoint) return '';

  const paramsHtml = endpoint.inputs.length
    ? `<ul class="query-params">${endpoint.inputs.map((input) => {
      const rawValue = values[input.name];
      const display = rawValue ? rawValue : `${input.placeholder || 'default'} (default)`;
      return `<li><strong>${escapeHtml(input.label)}:</strong> ${escapeHtml(display)}</li>`;
    }).join('')}</ul>`
    : '';

  return `
    <div class="query-info">
      <p class="query-description">${escapeHtml(endpoint.description)}</p>
      ${paramsHtml}
    </div>
  `;
}

function renderResults() {
  resultsPanel.innerHTML = `
    ${renderQueryInfo(lastQueryEndpoint, lastQueryValues)}
    ${renderTable(lastPayload)}
  `;

  resultsPanel.querySelectorAll('th[data-sort-key]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sortKey;
      if (sortState.key === key) {
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.key = key;
        sortState.direction = 'asc';
      }
      renderResults();
    });
  });

  const hasChart = lastQueryEndpoint && lastQueryEndpoint.chart && Array.isArray(lastPayload) && lastPayload.length;
  chartPanelSection.hidden = !hasChart;
  chartPanel.innerHTML = hasChart ? renderBarChart(lastPayload, lastQueryEndpoint.chart) : '';

  if (hasChart) {
    wireChartInteractions();
  }
}

async function runSelectedQuery() {
  const endpoint = selectedEndpoint;
  if (!endpoint) return;

  resultSummary.textContent = `Requesting ${endpoint.title.toLowerCase()}...`;
  resultsPanel.innerHTML = '<p class="empty-state">Loading...</p>';

  const values = {};
  if (dialogBody) {
    dialogBody.querySelectorAll('input').forEach((input) => {
      values[input.dataset.input] = input.value.trim();
    });
  }

  closeDialog();

  lastQueryEndpoint = endpoint;
  lastQueryValues = values;

  const targetPath = endpoint.builder(values);
  const fullTargetUrl = `${apiBaseUrl}${targetPath}`;
  const sameOriginAsApi = window.location.origin === apiBaseUrl;
  const targetUrl = sameOriginAsApi ? fullTargetUrl : `${proxyBaseUrl}${fullTargetUrl}`;

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store'
    });

    const payloadText = await response.text();
    let parsedPayload;
    try {
      parsedPayload = JSON.parse(payloadText);
    } catch (error) {
      parsedPayload = payloadText;
    }

    lastPayload = withComputedFields(parsedPayload);
    lastAttributeKeys = orderAttributeKeys(getAttributeKeys(lastPayload), endpoint.columnOrder);
    if (endpoint.curated) {
      const defaultKeys = lastAttributeKeys.filter((key) => DEFAULT_ATTRIBUTES.has(key));
      selectedAttributes = new Set(defaultKeys.length ? defaultKeys : lastAttributeKeys);
    } else {
      selectedAttributes = new Set(lastAttributeKeys);
    }
    sortState = { key: null, direction: 'asc' };

    renderResults();
    resultSummary.textContent = response.ok ? `Loaded ${endpoint.title.toLowerCase()}.` : `Request failed with ${response.status}`;
  } catch (error) {
    lastPayload = null;
    lastAttributeKeys = [];
    selectedAttributes = new Set();
    resultsPanel.innerHTML = `
      ${renderQueryInfo(lastQueryEndpoint, lastQueryValues)}
      <p class="empty-state">Request failed: ${escapeHtml(error.message)}</p>
    `;
    chartPanelSection.hidden = true;
    chartPanel.innerHTML = '';
    resultSummary.textContent = 'Request failed.';
  } finally {
    selectedEndpoint = null;
  }
}

function wireEvents() {
  // Dialog is created lazily when a query is selected.
}

renderQueryList();
