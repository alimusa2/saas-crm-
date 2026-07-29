export interface SpacingSide {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface BreakpointSpacing {
  desktop?: SpacingSide;
  tablet?: SpacingSide;
  mobile?: SpacingSide;
}

export interface BreakpointValue {
  desktop?: string;
  tablet?: string;
  mobile?: string;
}

export interface ElementLayoutSettings {
  margin?: BreakpointSpacing;
  padding?: BreakpointSpacing;
  width?: BreakpointValue;
  height?: BreakpointValue;
  minWidth?: BreakpointValue;
  maxWidth?: BreakpointValue;
  minHeight?: BreakpointValue;
  maxHeight?: BreakpointValue;
  
  // Custom spacing helper variables (like gaps)
  gap?: BreakpointValue;
  rowGap?: BreakpointValue;
  columnGap?: BreakpointValue;
}

export interface LayoutSettings extends ElementLayoutSettings {}

// Spacing helper to parse shorthand spacing like "10px 20px" or "0 0 16px 0"
export function parseShorthand(str?: string): SpacingSide {
  if (!str) return { top: '', right: '', bottom: '', left: '' };
  const parts = String(str).trim().split(/\s+/);
  if (parts.length === 1) {
    return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  }
  if (parts.length === 2) {
    return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  }
  if (parts.length === 3) {
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  }
  if (parts.length >= 4) {
    return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  }
  return { top: '', right: '', bottom: '', left: '' };
}

export function parseNumericValue(value: string | number | undefined): { val: number; unit: string } {
  if (value === undefined || value === null || value === '') {
    return { val: 0, unit: 'px' };
  }
  if (typeof value === 'number') {
    return { val: value, unit: 'px' };
  }
  const str = String(value).trim().toLowerCase();
  if (str === 'auto') return { val: 0, unit: 'auto' };
  if (str === 'fit-content') return { val: 0, unit: 'fit-content' };
  
  const num = parseFloat(str);
  if (isNaN(num)) {
    return { val: 0, unit: 'px' };
  }
  
  const unit = str.replace(String(num), '').trim();
  return { val: num, unit: unit || 'px' };
}

export function normalizeLayoutSettings(
  cfg: any,
  elementType: 'section' | 'row' | 'column' | 'component',
  componentType?: string
): LayoutSettings {
  const layout: LayoutSettings = {
    margin: {
      desktop: { top: '', right: '', bottom: '', left: '' },
      tablet: { top: '', right: '', bottom: '', left: '' },
      mobile: { top: '', right: '', bottom: '', left: '' }
    },
    padding: {
      desktop: { top: '', right: '', bottom: '', left: '' },
      tablet: { top: '', right: '', bottom: '', left: '' },
      mobile: { top: '', right: '', bottom: '', left: '' }
    },
    width: { desktop: '', tablet: '', mobile: '' },
    height: { desktop: '', tablet: '', mobile: '' },
    minWidth: { desktop: '', tablet: '', mobile: '' },
    maxWidth: { desktop: '', tablet: '', mobile: '' },
    minHeight: { desktop: '', tablet: '', mobile: '' },
    maxHeight: { desktop: '', tablet: '', mobile: '' }
  };

  if (cfg?.layoutSettings) {
    const ls = cfg.layoutSettings;
    if (ls.margin) {
      if (ls.margin.desktop) layout.margin!.desktop = { ...layout.margin!.desktop, ...ls.margin.desktop };
      if (ls.margin.tablet) layout.margin!.tablet = { ...layout.margin!.tablet, ...ls.margin.tablet };
      if (ls.margin.mobile) layout.margin!.mobile = { ...layout.margin!.mobile, ...ls.margin.mobile };
    }
    if (ls.padding) {
      if (ls.padding.desktop) layout.padding!.desktop = { ...layout.padding!.desktop, ...ls.padding.desktop };
      if (ls.padding.tablet) layout.padding!.tablet = { ...layout.padding!.tablet, ...ls.padding.tablet };
      if (ls.padding.mobile) layout.padding!.mobile = { ...layout.padding!.mobile, ...ls.padding.mobile };
    }
    if (ls.width) layout.width = { ...layout.width, ...ls.width };
    if (ls.height) layout.height = { ...layout.height, ...ls.height };
    if (ls.minWidth) layout.minWidth = { ...layout.minWidth, ...ls.minWidth };
    if (ls.maxWidth) layout.maxWidth = { ...layout.maxWidth, ...ls.maxWidth };
    if (ls.minHeight) layout.minHeight = { ...layout.minHeight, ...ls.minHeight };
    if (ls.maxHeight) layout.maxHeight = { ...layout.maxHeight, ...ls.maxHeight };
    return layout;
  }

  // --- Fallback to Legacy properties ---
  if (elementType === 'section') {
    if (cfg.padding_tb !== undefined || cfg.padding_lr !== undefined) {
      const tb = typeof cfg.padding_tb === 'number' ? `${cfg.padding_tb}px` : (cfg.padding_tb || '');
      const lr = typeof cfg.padding_lr === 'number' ? `${cfg.padding_lr}px` : (cfg.padding_lr || '');
      if (tb || lr) {
        layout.padding!.desktop = { top: tb || '0px', right: lr || '0px', bottom: tb || '0px', left: lr || '0px' };
      }
    } else if (cfg.padding) {
      layout.padding!.desktop = parseShorthand(cfg.padding);
    }

    if (cfg.margin) {
      layout.margin!.desktop = parseShorthand(cfg.margin);
    }
  }

  else if (elementType === 'row' || elementType === 'column') {
    if (cfg.padding) layout.padding!.desktop = parseShorthand(cfg.padding);
    if (cfg.margin) layout.margin!.desktop = parseShorthand(cfg.margin);
  }

  else if (elementType === 'component') {
    layout.width!.desktop = cfg.width || 'auto';
    layout.height!.desktop = cfg.height || 'auto';
    layout.maxWidth!.desktop = cfg.max_width || '';

    let defaultMargin = '0px 0px 16px 0px';
    if (componentType === 'Button' || componentType === 'Form') {
      defaultMargin = '16px 0px 16px 0px';
    } else if (componentType === 'Divider') {
      defaultMargin = '24px 0px 24px 0px';
    } else if (componentType === 'Spacer') {
      defaultMargin = '0px';
      layout.height!.desktop = cfg.height || '24px';
    }

    const m = cfg.margin !== undefined ? cfg.margin : defaultMargin;
    layout.margin!.desktop = parseShorthand(m);
    if (cfg.margin_mobile) {
      layout.margin!.mobile = parseShorthand(cfg.margin_mobile);
    }

    if (cfg.padding) {
      layout.padding!.desktop = parseShorthand(cfg.padding);
    }
    if (cfg.padding_mobile) {
      layout.padding!.mobile = parseShorthand(cfg.padding_mobile);
    }
  }

  return layout;
}

export function compileElementLayoutCSS(
  prefix: string,
  layout: ElementLayoutSettings
): { defaultRules: string; tabletRules: string; mobileRules: string } {
  
  const getSpacingString = (side?: SpacingSide): string => {
    if (!side) return '';
    const top = side.top !== undefined && side.top !== '' ? side.top : '';
    const right = side.right !== undefined && side.right !== '' ? side.right : '';
    const bottom = side.bottom !== undefined && side.bottom !== '' ? side.bottom : '';
    const left = side.left !== undefined && side.left !== '' ? side.left : '';
    
    // Only return if at least one side is specified
    if (top === '' && right === '' && bottom === '' && left === '') return '';
    
    return `${top || '0px'} ${right || '0px'} ${bottom || '0px'} ${left || '0px'}`;
  };

  let defaultRules = '';
  let tabletRules = '';
  let mobileRules = '';

  const className = `.${prefix}`;

  const compileViewport = (viewport: 'desktop' | 'tablet' | 'mobile'): string => {
    let rules = '';
    
    let paddingVal = '';
    let marginVal = '';
    if (viewport === 'desktop') {
      paddingVal = getSpacingString(layout.padding?.desktop);
      marginVal = getSpacingString(layout.margin?.desktop);
    } else if (viewport === 'tablet') {
      paddingVal = getSpacingString(layout.padding?.tablet);
      marginVal = getSpacingString(layout.margin?.tablet);
    } else if (viewport === 'mobile') {
      paddingVal = getSpacingString(layout.padding?.mobile);
      marginVal = getSpacingString(layout.margin?.mobile);
    }

    if (paddingVal) rules += `  padding: ${paddingVal} !important;\n`;
    if (marginVal) rules += `  margin: ${marginVal} !important;\n`;

    const w = layout.width?.[viewport];
    const h = layout.height?.[viewport];
    const minW = layout.minWidth?.[viewport];
    const maxW = layout.maxWidth?.[viewport];
    const minH = layout.minHeight?.[viewport];
    const maxH = layout.maxHeight?.[viewport];
    const gap = layout.gap?.[viewport];
    const rGap = layout.rowGap?.[viewport];
    const cGap = layout.columnGap?.[viewport];

    if (viewport === 'mobile' || viewport === 'tablet') {
      if (!maxW || maxW === '1200px') rules += `  max-width: 100% !important;\n`;
    }

    if (w !== undefined && w !== '') rules += `  width: ${w} !important;\n`;
    if (h !== undefined && h !== '') rules += `  height: ${h} !important;\n`;
    if (minW !== undefined && minW !== '') rules += `  min-width: ${minW} !important;\n`;
    if (maxW !== undefined && maxW !== '') rules += `  max-width: ${maxW} !important;\n`;
    if (minH !== undefined && minH !== '') rules += `  min-height: ${minH} !important;\n`;
    if (maxH !== undefined && maxH !== '') rules += `  max-height: ${maxH} !important;\n`;
    if (gap !== undefined && gap !== '') rules += `  gap: ${gap} !important;\n`;
    if (rGap !== undefined && rGap !== '') rules += `  row-gap: ${rGap} !important;\n`;
    if (cGap !== undefined && cGap !== '') rules += `  column-gap: ${cGap} !important;\n`;

    return rules;
  };

  const desktopStyles = compileViewport('desktop');
  if (desktopStyles) {
    defaultRules += `${className} {\n${desktopStyles}}\n`;
  }

  const tabletStyles = compileViewport('tablet');
  if (tabletStyles) {
    tabletRules += `${className} {\n${tabletStyles}}\n`;
  }

  const mobileStyles = compileViewport('mobile');
  if (mobileStyles) {
    mobileRules += `${className} {\n${mobileStyles}}\n`;
  }

  return { defaultRules, tabletRules, mobileRules };
}
