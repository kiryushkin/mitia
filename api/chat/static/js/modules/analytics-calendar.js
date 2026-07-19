const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

export const CalendarModule = {
    buildMonth(year, month, analyticsModule) {
        const wrapper = document.createElement('div');
        wrapper.className = 'calendar-month';

        const header = document.createElement('div');
        header.className = 'calendar-month-header';

        const monthStart = analyticsModule.dateKey(new Date(year, month, 1));
        const monthEnd = analyticsModule.dateKey(new Date(year, month + 1, 0));
        const bounds = analyticsModule.getCalendarBounds();
        const canPrev = monthStart > bounds.min;
        const canNext = monthEnd < bounds.max;

        const prevBtn = document.createElement('button');
        prevBtn.className = 'calendar-nav-btn';
        prevBtn.type = 'button';
        prevBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>';
        prevBtn.title = canPrev ? 'Предыдущий месяц' : 'Данные доступны с даты регистрации';
        if (canPrev) {
            prevBtn.onclick = () => this.navCalendar(-1, analyticsModule);
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
            nextBtn.onclick = () => this.navCalendar(1, analyticsModule);
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
        ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach((d) => {
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
            daysGrid.appendChild(this.buildDayCell(day, month === 0 ? 11 : month - 1, month === 0 ? year - 1 : year, true, analyticsModule));
        }

        for (let d = 1; d <= lastDay.getDate(); d++) {
            daysGrid.appendChild(this.buildDayCell(d, month, year, false, analyticsModule));
        }

        const totalCells = startDow + lastDay.getDate();
        const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
        for (let d = 1; d <= remaining; d++) {
            daysGrid.appendChild(this.buildDayCell(d, month === 11 ? 0 : month + 1, month === 11 ? year + 1 : year, true, analyticsModule));
        }

        wrapper.appendChild(daysGrid);
        return wrapper;
    },

    buildDayCell(day, month, year, otherMonth, analyticsModule) {
        const cell = document.createElement('button');
        cell.className = 'calendar-day';
        cell.textContent = day;
        cell.type = 'button';

        if (otherMonth) cell.classList.add('other-month');

        const date = new Date(year, month, day);
        const dateStr = analyticsModule.dateKey(date);
        const today = new Date();
        if (date.toDateString() === today.toDateString()) cell.classList.add('today');

        const bounds = analyticsModule.getCalendarBounds();
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

        const normalized = analyticsModule.normalizeDateRange();
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

            const current = analyticsModule.normalizeDateRange();
            const f = current.from;
            const t = current.to;

            if (!f && !t) {
                analyticsModule.state.dateRange = { from: dateStr, to: dateStr };
            } else if (f === t) {
                if (dateStr === f) {
                    analyticsModule.state.dateRange = { from: null, to: null };
                } else {
                    analyticsModule.state.dateRange = {
                        from: dateStr < f ? dateStr : f,
                        to: dateStr > f ? dateStr : f
                    };
                }
            } else {
                if (dateStr === f && dateStr === t) {
                    analyticsModule.state.dateRange = { from: null, to: null };
                } else if (dateStr === f) {
                    analyticsModule.state.dateRange = { from: t, to: t };
                } else if (dateStr === t) {
                    analyticsModule.state.dateRange = { from: f, to: f };
                } else {
                    analyticsModule.state.dateRange = { from: dateStr, to: dateStr };
                }
            }

            analyticsModule.state.dateRange = analyticsModule.clampDateRange(analyticsModule.state.dateRange);
            analyticsModule.state.periodPreset = 'custom';
            analyticsModule.applyDateRangeToChartsState();
            this.renderCalendar(analyticsModule);
            analyticsModule.reloadAnalyticsAndFaq();
        };

        return cell;
    },

    navCalendar(delta, analyticsModule) {
        let m = analyticsModule.state.calendarMonth + delta;
        let y = analyticsModule.state.calendarYear;
        if (m < 0) { m = 11; y--; }
        if (m > 11) { m = 0; y++; }

        const monthStart = analyticsModule.dateKey(new Date(y, m, 1));
        const monthEnd = analyticsModule.dateKey(new Date(y, m + 1, 0));
        const bounds = analyticsModule.getCalendarBounds();

        if (monthEnd < bounds.min || monthStart > bounds.max) {
            return;
        }

        analyticsModule.state.calendarMonth = m;
        analyticsModule.state.calendarYear = y;
        this.renderCalendar(analyticsModule);
    },

    renderCalendar(analyticsModule) {
        const container = document.getElementById('analytics-calendar-single');
        if (!container) return;

        analyticsModule.updateQuickPeriodButtons();
        analyticsModule.updateModeButtons();

        analyticsModule.state.dateRange = analyticsModule.clampDateRange(analyticsModule.state.dateRange);
        const bounds = analyticsModule.getCalendarBounds();
        const currentMonthStart = analyticsModule.dateKey(new Date(analyticsModule.state.calendarYear, analyticsModule.state.calendarMonth, 1));
        const currentMonthEnd = analyticsModule.dateKey(new Date(analyticsModule.state.calendarYear, analyticsModule.state.calendarMonth + 1, 0));
        if (currentMonthEnd < bounds.min || currentMonthStart > bounds.max) {
            const maxDate = analyticsModule.parseDateKey(bounds.max) || new Date();
            analyticsModule.state.calendarYear = maxDate.getFullYear();
            analyticsModule.state.calendarMonth = maxDate.getMonth();
        }

        container.innerHTML = '';
        container.appendChild(this.buildMonth(analyticsModule.state.calendarYear, analyticsModule.state.calendarMonth, analyticsModule));

        const info = document.getElementById('analytics-date-range-info');
        if (info) {
            const normalized = analyticsModule.normalizeDateRange();
            const from = normalized.from;
            const to = normalized.to;
            if (from && to && from !== to) {
                info.textContent = `${analyticsModule.formatDateShort(from)} — ${analyticsModule.formatDateShort(to)}`;
            } else if (from && to && from === to) {
                info.textContent = `Дата: ${analyticsModule.formatDateShort(from)}`;
            } else {
                info.textContent = '';
            }

            const suffix = bounds.maxSource === 'snapshot'
                ? 'Доступны даты до последнего подготовленного среза.'
                : 'Выбор дат после текущего дня недоступен.';
            info.title = `Границы: ${analyticsModule.formatDateShort(bounds.min)} — ${analyticsModule.formatDateShort(bounds.max)}. ${suffix}`;
        }
    }
};
