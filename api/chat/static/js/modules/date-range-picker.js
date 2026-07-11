/**
 * Date Range Picker for Analytics
 * Dual calendar with presets, range selection, and keyboard shortcuts
 */

class DateRangePicker {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    this.onApply = options.onApply || (() => {});
    this.onCancel = options.onCancel || (() => {});
    this.locale = options.locale || 'en';
    
    this.startDate = options.startDate || new Date();
    this.endDate = options.endDate || new Date();
    this.hoveredDate = null;
    
    this.monthOffset = 0; // For dual calendar
    this.selectedStart = null;
    this.selectedEnd = null;
    
    this.init();
  }
  
  init() {
    this.render();
    this.attachEventListeners();
  }
  
  render() {
    this.container.innerHTML = this.getTemplate();
    this.updateCalendars();
  }
  
  getTemplate() {
    return `
      <div class="date-range-picker">
        <div class="drp-header">
          <h3>Выбрать период</h3>
          <button class="drp-close" aria-label="Close">×</button>
        </div>
        
        <div class="drp-body">
          <!-- Presets -->
          <div class="drp-presets">
            <button class="drp-preset" data-preset="today">Сегодня</button>
            <button class="drp-preset" data-preset="yesterday">Вчера</button>
            <button class="drp-preset" data-preset="7days">7 дней</button>
            <button class="drp-preset" data-preset="30days">30 дней</button>
            <button class="drp-preset" data-preset="thisMonth">Этот месяц</button>
            <button class="drp-preset" data-preset="lastMonth">Прошлый месяц</button>
            <button class="drp-preset" data-preset="reset">Сброс</button>
          </div>
          
          <!-- Dual Calendar -->
          <div class="drp-calendars">
            <div class="drp-calendar" id="calendar-left"></div>
            <div class="drp-calendar" id="calendar-right"></div>
          </div>
        </div>
        
        <div class="drp-footer">
          <button class="drp-btn drp-btn-cancel">Отмена</button>
          <button class="drp-btn drp-btn-apply">Применить</button>
        </div>
      </div>
    `;
  }
  
  attachEventListeners() {
    // Presets
    this.container.querySelectorAll('.drp-preset').forEach(btn => {
      btn.addEventListener('click', (e) => this.applyPreset(e.target.dataset.preset));
    });
    
    // Calendar days
    this.container.addEventListener('click', (e) => {
      if (e.target.classList.contains('drp-day')) {
        this.selectDate(new Date(e.target.dataset.date));
      }
    });
    
    // Hover on days
    this.container.addEventListener('mouseover', (e) => {
      if (e.target.classList.contains('drp-day')) {
        this.hoveredDate = new Date(e.target.dataset.date);
        this.updateDayStates();
      }
    });
    
    this.container.addEventListener('mouseout', (e) => {
      if (e.target.classList.contains('drp-day')) {
        this.hoveredDate = null;
        this.updateDayStates();
      }
    });
    
    // Buttons
    this.container.querySelector('.drp-btn-apply').addEventListener('click', () => this.apply());
    this.container.querySelector('.drp-btn-cancel').addEventListener('click', () => this.cancel());
    this.container.querySelector('.drp-close').addEventListener('click', () => this.cancel());
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => this.handleKeyboard(e));
  }
  
  handleKeyboard(e) {
    if (!this.container.offsetParent) return; // Not visible
    
    if (e.key === 'PageUp') {
      e.preventDefault();
      this.monthOffset--;
      this.updateCalendars();
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      this.monthOffset++;
      this.updateCalendars();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.apply();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.cancel();
    }
  }
  
  selectDate(date) {
    if (!this.selectedStart || this.selectedEnd) {
      this.selectedStart = date;
      this.selectedEnd = null;
    } else {
      if (date < this.selectedStart) {
        this.selectedEnd = this.selectedStart;
        this.selectedStart = date;
      } else {
        this.selectedEnd = date;
      }
    }
    this.updateDayStates();
  }
  
  applyPreset(preset) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    switch (preset) {
      case 'today':
        this.selectedStart = new Date(today);
        this.selectedEnd = new Date(today);
        break;
      case 'yesterday':
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        this.selectedStart = yesterday;
        this.selectedEnd = new Date(yesterday);
        break;
      case '7days':
        const start7 = new Date(today);
        start7.setDate(start7.getDate() - 6);
        this.selectedStart = start7;
        this.selectedEnd = new Date(today);
        break;
      case '30days':
        const start30 = new Date(today);
        start30.setDate(start30.getDate() - 29);
        this.selectedStart = start30;
        this.selectedEnd = new Date(today);
        break;
      case 'thisMonth':
        this.selectedStart = new Date(today.getFullYear(), today.getMonth(), 1);
        this.selectedEnd = new Date(today);
        break;
      case 'lastMonth':
        const lastMonthDate = new Date(today);
        lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
        this.selectedStart = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth(), 1);
        this.selectedEnd = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth() + 1, 0);
        break;
      case 'reset':
        this.selectedStart = null;
        this.selectedEnd = null;
        break;
    }
    this.monthOffset = 0;
    this.updateCalendars();
  }
  
  updateCalendars() {
    const leftMonth = new Date();
    leftMonth.setMonth(leftMonth.getMonth() + this.monthOffset);
    
    const rightMonth = new Date(leftMonth);
    rightMonth.setMonth(rightMonth.getMonth() + 1);
    
    this.renderCalendar(document.getElementById('calendar-left'), leftMonth);
    this.renderCalendar(document.getElementById('calendar-right'), rightMonth);
    
    this.updateDayStates();
  }
  
  renderCalendar(element, date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());
    
    let html = `
      <div class="drp-month-header">
        <div class="drp-month-title">${this.formatMonthYear(date)}</div>
      </div>
      <div class="drp-weekdays">
        <div>Пн</div>
        <div>Вт</div>
        <div>Ср</div>
        <div>Чт</div>
        <div>Пт</div>
        <div>Сб</div>
        <div>Вс</div>
      </div>
      <div class="drp-days">
    `;
    
    const currentDate = new Date(startDate);
    for (let i = 0; i < 42; i++) {
      const isCurrentMonth = currentDate.getMonth() === month;
      const dateStr = currentDate.toISOString().split('T')[0];
      const isDisabled = !isCurrentMonth;
      
      html += `
        <button 
          class="drp-day ${isDisabled ? 'drp-day-disabled' : ''}" 
          data-date="${dateStr}"
          ${isDisabled ? 'disabled' : ''}
        >
          ${currentDate.getDate()}
        </button>
      `;
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    html += '</div>';
    element.innerHTML = html;
  }
  
  updateDayStates() {
    this.container.querySelectorAll('.drp-day:not(.drp-day-disabled)').forEach(dayBtn => {
      const dateStr = dayBtn.dataset.date;
      const date = new Date(dateStr);
      
      dayBtn.classList.remove('drp-day-start', 'drp-day-end', 'drp-day-in-range', 'drp-day-hover');
      
      if (this.selectedStart && this.formatDate(date) === this.formatDate(this.selectedStart)) {
        dayBtn.classList.add('drp-day-start');
      }
      if (this.selectedEnd && this.formatDate(date) === this.formatDate(this.selectedEnd)) {
        dayBtn.classList.add('drp-day-end');
      }
      
      if (this.selectedStart && this.selectedEnd) {
        if (date > this.selectedStart && date < this.selectedEnd) {
          dayBtn.classList.add('drp-day-in-range');
        }
      } else if (this.selectedStart && this.hoveredDate) {
        if (this.hoveredDate > this.selectedStart) {
          if (date > this.selectedStart && date <= this.hoveredDate) {
            dayBtn.classList.add('drp-day-hover');
          }
        } else if (this.hoveredDate < this.selectedStart) {
          if (date >= this.hoveredDate && date < this.selectedStart) {
            dayBtn.classList.add('drp-day-hover');
          }
        }
      }
    });
  }
  
  formatDate(date) {
    return date.toISOString().split('T')[0];
  }
  
  formatMonthYear(date) {
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return `${months[date.getMonth()]} ${date.getFullYear()}`;
  }
  
  apply() {
    if (this.selectedStart && this.selectedEnd) {
      this.onApply({
        startDate: this.selectedStart,
        endDate: this.selectedEnd
      });
    }
    this.cancel();
  }
  
  cancel() {
    this.onCancel();
  }
  
  setDateRange(startDate, endDate) {
    this.selectedStart = startDate;
    this.selectedEnd = endDate;
    this.updateDayStates();
  }
  
  getDateRange() {
    return {
      startDate: this.selectedStart,
      endDate: this.selectedEnd
    };
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DateRangePicker;
}
