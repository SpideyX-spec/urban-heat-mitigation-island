import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, ChevronDown, Check, MapPin, X } from 'lucide-react';
import './CityCombobox.css';

export default function CityCombobox({
  cities = [],
  selectedCityId,
  onSelectCity,
  disabled = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Group cities by State / Region
  const groupedCities = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const filtered = cities.filter(c => {
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.state && c.state.toLowerCase().includes(q)) ||
        (c.country && c.country.toLowerCase().includes(q)) ||
        c.id.toLowerCase().includes(q)
      );
    });

    const groups = {};
    filtered.forEach(city => {
      const groupKey = city.state || city.country || 'Other';
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(city);
    });

    return Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .map(group => ({
        state: group,
        cities: groups[group].sort((a, b) => a.name.localeCompare(b.name))
      }));
  }, [cities, searchQuery]);

  // Flattened list for keyboard navigation
  const flatCities = useMemo(() => {
    return groupedCities.flatMap(g => g.cities);
  }, [groupedCities]);

  const selectedCity = useMemo(() => {
    return cities.find(c => c.id === selectedCityId) || null;
  }, [cities, selectedCityId]);

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearchQuery('');
        setHighlightedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 30);
      setHighlightedIndex(flatCities.findIndex(c => c.id === selectedCityId));
    }
  }, [isOpen]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listRef.current) {
      const activeEl = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleSelect = (cityId) => {
    onSelectCity(cityId);
    setIsOpen(false);
    setSearchQuery('');
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev + 1 < flatCities.length ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev - 1 >= 0 ? prev - 1 : flatCities.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && flatCities[highlightedIndex]) {
        handleSelect(flatCities[highlightedIndex].id);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setSearchQuery('');
      setHighlightedIndex(-1);
    }
  };

  return (
    <div className="city-combobox-container" ref={containerRef} onKeyDown={handleKeyDown}>
      {/* Combobox Trigger */}
      <button
        type="button"
        className={`city-combobox-trigger${isOpen ? ' is-open' : ''}`}
        onClick={() => !disabled && setIsOpen(prev => !prev)}
        disabled={disabled || cities.length === 0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select City"
      >
        <span className="trigger-pin-icon" aria-hidden="true">
          <MapPin size={13} />
        </span>
        <span className="trigger-label">
          {selectedCity ? (
            <>
              <strong className="city-name">{selectedCity.name}</strong>
              {selectedCity.state && (
                <span className="city-state font-mono"> · {selectedCity.state}</span>
              )}
            </>
          ) : (
            <span className="city-placeholder">Select City…</span>
          )}
        </span>
        <span className="trigger-chevron" aria-hidden="true">
          <ChevronDown
            size={13}
            style={{
              transform: isOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s ease'
            }}
          />
        </span>
      </button>

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="city-combobox-dropdown" role="listbox">
          {/* Search Input Bar */}
          <div className="combobox-search-bar">
            <Search size={13} className="search-icon" aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className="combobox-search-input"
              placeholder="Search city or state..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setHighlightedIndex(0);
              }}
              aria-label="Filter cities by name or state"
            />
            {searchQuery && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search query"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Grouped City List */}
          <div className="combobox-list-scroll" ref={listRef}>
            {groupedCities.length === 0 ? (
              <div className="combobox-empty">
                No cities found matching &ldquo;{searchQuery}&rdquo;
              </div>
            ) : (
              groupedCities.map((group) => (
                <div key={group.state} className="combobox-group">
                  <div className="combobox-group-header font-mono">
                    <span>{group.state}</span>
                    <span className="group-count">{group.cities.length}</span>
                  </div>
                  {group.cities.map((city) => {
                    const currentIndex = flatCities.findIndex(c => c.id === city.id);
                    const isSelected = city.id === selectedCityId;
                    const isHighlighted = currentIndex === highlightedIndex;

                    return (
                      <div
                        key={city.id}
                        data-index={currentIndex}
                        role="option"
                        aria-selected={isSelected}
                        className={`combobox-option${isSelected ? ' is-selected' : ''}${isHighlighted ? ' is-highlighted' : ''}`}
                        onClick={() => handleSelect(city.id)}
                        onMouseEnter={() => setHighlightedIndex(currentIndex)}
                      >
                        <div className="option-text">
                          <span className="option-city-name">{city.name}</span>
                          <span className="option-state-tag font-mono">{city.state || city.country}</span>
                        </div>
                        {isSelected && (
                          <span className="option-check" aria-hidden="true">
                            <Check size={13} />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
