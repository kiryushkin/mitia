/**
 * Календарь для фильтра по дате (оригинальная реализация)
 */

import { state } from '../state.js';

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь',
    'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

let onDateSelect = null;

/**
 * Инициализация календаря
 */
export function initCalendar(onSelect) {
    onDateSelect = onSelect;
    const now = new Date();
    state.calendarYear = now.getFullYear();
    state.calendarMonth = now.getMonth();
    renderCalendar();
}

export function renderCalendar() {
    const container = document.getElementById('calendar-single');
    if (!container) return;

    container.innerHTML = '';
    container.appendChild(buildMonth(state.calendarYear, state.calendarMonth));

    updateRangeInfo();
}

function buildMonth(year, month) {
    const wrapper = document.createElement('div');
    wrapper.className = 'calendar-month';

    const header = document.createElement('div');
    header.className = 'calendar-month-header';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'calendar-nav-btn';
    prevBtn.type = 'button';
    prevBtn.textContent = '‹';
    prevBtn.onclick = () => navCalendar(-1);

    const title = document.createElement('div');
    title.className = 'calendar-month-title';
    title.textContent = `${MONTH_NAMES[month]} ${year}`;

    const nextBtn = document.createElement('button');
    nextBtn.className = 'calendar-nav-btn';
    nextBtn.type = 'button';
    nextBtn.textContent = '›';
    nextBtn.onclick = () => navCalendar(1);

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

    const from = state.dateRange.from;
    const to = state.dateRange.to;

    if (from && !to && dateStr === from) {
        cell.classList.add('selected', 'single');
    } else {
        if (from && dateStr === from) cell.classList.add('selected', 'range-start');
        if (to && dateStr === to) cell.classList.add('selected', 'range-end');
        if (from && to && dateStr > from && dateStr < to) cell.classList.add('in-range');
    }

    cell.onclick = () => {
        if (otherMonth) return;

        const f = state.dateRange.from;
        const t = state.dateRange.to;

        if (!f && !t) {
            // Ничего не выбрано → выбрать одну дату
            state.dateRange = { from: dateStr, to: null };
            if (onDateSelect) onDateSelect();
        } else if (f && !t) {
            // Выбрана одна дата
            if (dateStr === f) {
                // Та же дата → снять выделение
                state.dateRange = { from: null, to: null };
                if (onDateSelect) onDateSelect();
            } else {
                // Другая дата → диапазон
                state.dateRange = {
                    from: dateStr < f ? dateStr : f,
                    to: dateStr > f ? dateStr : f
                };
                if (onDateSelect) onDateSelect();
            }
        } else if (f && t) {
            // Выбран диапазон
            if (dateStr === f) {
                // Нажали на начало → остаётся только конец
                state.dateRange = { from: t, to: null };
                if (onDateSelect) onDateSelect();
            } else if (dateStr === t) {
                // Нажали на конец → снять всё
                state.dateRange = { from: null, to: null };
                if (onDateSelect) onDateSelect();
            } else {
                // Нажали вне диапазона → начать новый выбор
                state.dateRange = { from: dateStr, to: null };
                if (onDateSelect) onDateSelect();
            }
        }

        renderCalendar();
    };

    return cell;
}

function navCalendar(delta) {
    let m = state.calendarMonth + delta;
    let y = state.calendarYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    state.calendarMonth = m;
    state.calendarYear = y;
    renderCalendar();
}

function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function updateRangeInfo() {
    const info = document.getElementById('date-range-info');
    if (!info) return;
    const from = state.dateRange.from;
    const to = state.dateRange.to;
    if (from && to) {
        info.textContent = `${formatDateShort(from)} — ${formatDateShort(to)}`;
    } else if (from) {
        info.textContent = `С ${formatDateShort(from)} — выберите конечную дату`;
    } else {
        info.textContent = '';
    }
}

function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${d}.${m}.${y}`;
}
