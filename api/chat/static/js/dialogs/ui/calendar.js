import { state } from '../state.js';

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь',
    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

let onDateSelect = null;

function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseDateKey(dateStr) {
    if (!dateStr || typeof dateStr !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    const date = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function getTodayDateKey() {
    return dateKey(new Date());
}

function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.${y}`;
}

function calculateQuickPeriodRange(period, bounds = getCalendarBounds()) {
    if (!period) return null;

    const maxDateObj = parseDateKey(bounds.max) || new Date();
    let to = new Date(maxDateObj.getFullYear(), maxDateObj.getMonth(), maxDateObj.getDate());
    let from = new Date(to);

    if (period === 'today') {
    } else if (period === 'yesterday') {
        from.setDate(to.getDate() - 1);
        to = new Date(from);
    } else if (period === 'week') {
        from.setDate(to.getDate() - 6);
    } else if (period === 'month') {
        from.setDate(to.getDate() - 29);
    } else if (period === 'quarter') {
        from.setDate(to.getDate() - 89);
    } else if (period === 'year') {
        from = new Date(to.getFullYear(), 0, 1);
    } else {
        return null;
    }

    return {
        from: dateKey(from),
        to: dateKey(to)
    };
}

function isQuickPeriodAvailable(period, bounds = getCalendarBounds()) {
    const range = calculateQuickPeriodRange(period, bounds);
    if (!range) return false;
    return range.from >= bounds.min && range.to <= bounds.max;
}

function updateQuickPeriodButtons() {
    const bounds = getCalendarBounds();
    document.querySelectorAll('.dialogs-period-btn').forEach((btn) => {
        const period = btn.dataset.period;
        const isAvailable = isQuickPeriodAvailable(period, bounds);
        const isActive = period === state.periodPreset && isAvailable;

        btn.classList.toggle('is-disabled', !isAvailable);
        btn.classList.toggle('active', isActive);
        btn.title = isAvailable ? '' : 'Период станет доступен после накопления данных';
    });
}

export function applyQuickPeriod(period, triggerSelect = true) {
    const bounds = getCalendarBounds();
    if (!isQuickPeriodAvailable(period, bounds)) {
        return;
    }
    let range = calculateQuickPeriodRange(period, bounds) || { from: bounds.max, to: bounds.max };
    range = clampDateRange(range);

    state.periodPreset = period;
    state.dateRange = range;

    const calendarTo = parseDateKey(range.to) || parseDateKey(bounds.max) || new Date();
    state.calendarYear = calendarTo.getFullYear();
    state.calendarMonth = calendarTo.getMonth();

    renderCalendar();
    if (triggerSelect && onDateSelect) onDateSelect();
}

function bindQuickPeriodButtons() {
    document.querySelectorAll('.dialogs-period-btn').forEach((btn) => {
        btn.onclick = () => {
            const period = btn.dataset.period;
            if (!period) return;

            if (state.periodPreset === period) {
                state.periodPreset = null;
                state.dateRange = { from: null, to: null };
                renderCalendar();
                if (onDateSelect) onDateSelect();
                return;
            }

            const bounds = getCalendarBounds();
            const isAvailable = isQuickPeriodAvailable(period, bounds);
            if (!isAvailable) {
                const title = 'Период пока недоступен';
                const text = `Период «${btn.textContent?.trim() || period}» станет доступен после накопления данных. Сейчас доступны даты: ${formatDateShort(bounds.min)} — ${formatDateShort(bounds.max)}.`;

                if (typeof window.showAlert === 'function') {
                    window.showAlert('tmpl-error-alert', { title, text });
                } else {
                    alert(text);
                }
                return;
            }

            applyQuickPeriod(period, true);
        };
    });
}

function getCalendarBounds() {
    const todayKey = getTodayDateKey();
    const rawMin = state.calendarBounds?.minDate || todayKey;
    const rawMax = state.calendarBounds?.maxDate || todayKey;
    let min = parseDateKey(rawMin) ? rawMin : todayKey;
    let max = parseDateKey(rawMax) ? rawMax : todayKey;

    if (max > todayKey) max = todayKey;
    if (min > max) min = max;

    return {
        min,
        max,
        maxSource: state.calendarBounds?.maxSource || 'today'
    };
}

function clampDateRange(range = state.dateRange) {
    const bounds = getCalendarBounds();
    let from = range?.from || null;
    let to = range?.to || null;

    if (from && !parseDateKey(from)) from = null;
    if (to && !parseDateKey(to)) to = null;

    if (!from && !to) {
        return { from: null, to: null };
    }

    if (from && !to) {
        return {
            from: from < bounds.min ? bounds.min : from,
            to: null
        };
    }

    if (!from && to) {
        return {
            from: null,
            to: to > bounds.max ? bounds.max : to
        };
    }

    if (from > to) [from, to] = [to, from];
    if (from < bounds.min) from = bounds.min;
    if (to > bounds.max) to = bounds.max;
    if (from > to) from = to;

    return { from, to };
}

export function initCalendar(onSelect) {
    onDateSelect = onSelect;
    const bounds = getCalendarBounds();
    const maxDate = parseDateKey(bounds.max) || new Date();
    state.calendarYear = maxDate.getFullYear();
    state.calendarMonth = maxDate.getMonth();

    bindQuickPeriodButtons();

    if (state.periodPreset && isQuickPeriodAvailable(state.periodPreset, bounds)) {
        applyQuickPeriod(state.periodPreset, false);
    } else {
        state.periodPreset = null;
        state.dateRange = clampDateRange({ from: null, to: null });
        renderCalendar();
    }
}

export function renderCalendar() {
    const container = document.getElementById('calendar-single');
    if (!container) return;

    updateQuickPeriodButtons();
    state.dateRange = clampDateRange(state.dateRange);
    const bounds = getCalendarBounds();
    const currentMonthStart = dateKey(new Date(state.calendarYear, state.calendarMonth, 1));
    const currentMonthEnd = dateKey(new Date(state.calendarYear, state.calendarMonth + 1, 0));

    if (currentMonthEnd < bounds.min || currentMonthStart > bounds.max) {
        const maxDate = parseDateKey(bounds.max) || new Date();
        state.calendarYear = maxDate.getFullYear();
        state.calendarMonth = maxDate.getMonth();
    }

    container.innerHTML = '';
    container.appendChild(buildMonth(state.calendarYear, state.calendarMonth));

    updateRangeInfo();
}

function buildMonth(year, month) {
    const wrapper = document.createElement('div');
    wrapper.className = 'calendar-month';

    const header = document.createElement('div');
    header.className = 'calendar-month-header';

    const monthStart = dateKey(new Date(year, month, 1));
    const monthEnd = dateKey(new Date(year, month + 1, 0));
    const bounds = getCalendarBounds();
    const canPrev = monthStart > bounds.min;
    const canNext = monthEnd < bounds.max;

    const prevBtn = document.createElement('button');
    prevBtn.className = 'calendar-nav-btn';
    prevBtn.type = 'button';
    prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
    prevBtn.title = canPrev ? 'Предыдущий месяц' : 'Данные доступны с даты регистрации';
    if (canPrev) {
        prevBtn.onclick = () => navCalendar(-1);
    } else {
        prevBtn.disabled = true;
        prevBtn.classList.add('is-disabled');
    }

    const title = document.createElement('div');
    title.className = 'calendar-month-title';
    title.textContent = `${MONTH_NAMES[month]} ${year}`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'calendar-nav-btn';
    nextBtn.type = 'button';
    nextBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    nextBtn.title = canNext
        ? 'Следующий месяц'
        : (bounds.maxSource === 'snapshot'
            ? 'Данные за более поздние даты пока не готовы'
            : 'Выбор дат после текущего дня недоступен');
    if (canNext) {
        nextBtn.onclick = () => navCalendar(1);
    } else {
        nextBtn.disabled = true;
        nextBtn.classList.add('is-disabled');
    }

    header.appendChild(prevBtn);
    header.appendChild(title);
    header.appendChild(nextBtn);
    wrapper.appendChild(header);

    const weekdays = document.createElement('div');
    weekdays.className = 'calendar-weekdays';
    ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d => {
        const wd = document.createElement('span');
        wd.className = 'calendar-weekday';
        wd.textContent = d;
        weekdays.appendChild(wd);
    });
    wrapper.appendChild(weekdays);

    const daysGrid = document.createElement('div');
    daysGrid.className = 'calendar-days';

    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDow = (firstDay.getDay() + 6) % 7;

    const prevLast = new Date(year, month, 0).getDate();
    for (let i = startDow - 1; i >= 0; i--) {
        const day = prevLast - i;
        const cell = buildDayCell(day, month === 0 ? 11 : month - 1, month === 0 ? year - 1 : year, true);
        daysGrid.appendChild(cell);
    }

    for (let d = 1; d <= lastDay.getDate(); d++) {
        const cell = buildDayCell(d, month, year, false);
        daysGrid.appendChild(cell);
    }

    const totalCells = startDow + lastDay.getDate();
    const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (let d = 1; d <= remaining; d++) {
        const cell = buildDayCell(d, month === 11 ? 0 : month + 1, month === 11 ? year + 1 : year, true);
        daysGrid.appendChild(cell);
    }

    wrapper.appendChild(daysGrid);
    return wrapper;
}

function buildDayCell(day, month, year, otherMonth) {
    const cell = document.createElement('button');
    cell.className = 'calendar-day';
    cell.textContent = day;
    cell.type = 'button';

    if (otherMonth) {
        cell.classList.add('other-month');
    }

    const date = new Date(year, month, day);
    const dateStr = dateKey(date);

    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
        cell.classList.add('today');
    }

    const bounds = getCalendarBounds();
    const outOfBounds = dateStr < bounds.min || dateStr > bounds.max;

    if (outOfBounds) {
        cell.classList.add('is-disabled');
        cell.disabled = true;
        cell.title = dateStr < bounds.min
            ? 'Дата вне доступного периода: до регистрации'
            : (bounds.maxSource === 'snapshot'
                ? 'Данные за эту дату пока не подготовлены'
                : 'Дата вне доступного периода: после текущего дня');
    }

    const normalized = clampDateRange(state.dateRange);
    const from = normalized.from;
    const to = normalized.to;

    if (from && to && from === to && dateStr === from) {
        cell.classList.add('selected', 'single');
    } else {
        if (from && dateStr === from) cell.classList.add('selected', 'range-start');
        if (to && dateStr === to) cell.classList.add('selected', 'range-end');
        if (from && to && dateStr > from && dateStr < to) cell.classList.add('in-range');
    }

    cell.onclick = () => {
        if (otherMonth || outOfBounds) return;

        const normalizedCurrent = clampDateRange(state.dateRange);
        const f = normalizedCurrent.from;
        const t = normalizedCurrent.to;

        if (!f && !t) {
            state.dateRange = { from: dateStr, to: dateStr };
        } else if (f === t) {
            if (dateStr === f) {
                state.dateRange = { from: null, to: null };
            } else {
                state.dateRange = {
                    from: dateStr < f ? dateStr : f,
                    to: dateStr > f ? dateStr : f
                };
            }
        } else {
            if (dateStr === f && dateStr === t) {
                state.dateRange = { from: null, to: null };
            } else if (dateStr === f) {
                state.dateRange = { from: t, to: t };
            } else if (dateStr === t) {
                state.dateRange = { from: f, to: f };
            } else {
                state.dateRange = { from: dateStr, to: dateStr };
            }
        }

        state.dateRange = clampDateRange(state.dateRange);
        state.periodPreset = 'custom';
        renderCalendar();
        if (onDateSelect) onDateSelect();
    };

    return cell;
}

function navCalendar(delta) {
    let m = state.calendarMonth + delta;
    let y = state.calendarYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }

    const monthStart = dateKey(new Date(y, m, 1));
    const monthEnd = dateKey(new Date(y, m + 1, 0));
    const bounds = getCalendarBounds();

    if (monthEnd < bounds.min || monthStart > bounds.max) {
        return;
    }

    state.calendarMonth = m;
    state.calendarYear = y;
    renderCalendar();
}

function updateRangeInfo() {
    const info = document.getElementById('date-range-info');
    if (!info) return;

    const bounds = getCalendarBounds();
    const normalized = clampDateRange(state.dateRange);
    state.dateRange = normalized;

    const from = normalized.from;
    const to = normalized.to;
    if (from && to && from !== to) {
        info.textContent = `${formatDateShort(from)} — ${formatDateShort(to)}`;
    } else if (from && to && from === to) {
        info.textContent = `Дата: ${formatDateShort(from)}`;
    } else {
        info.textContent = '';
    }

    const suffix = bounds.maxSource === 'snapshot'
        ? 'Доступны даты до последнего подготовленного среза.'
        : 'Выбор дат после текущего дня недоступен.';
    info.title = `Границы: ${formatDateShort(bounds.min)} — ${formatDateShort(bounds.max)}. ${suffix}`;
}

