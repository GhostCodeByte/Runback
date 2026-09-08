import {
  displayValue,
  regionSpeech,
  regionsInView,
} from '../src/ui/BodyMap';

describe('Muskelkarte', () => {
  it('hält unbekannt von null und numerischen Werten getrennt', () => {
    expect(displayValue(null)).toBe('–');
    expect(displayValue(undefined)).toBe('–');
    expect(displayValue(62.4)).toBe('62');
    expect(regionSpeech('freshness', 'quad_l', null)).toContain('unbekannt');
    expect(regionSpeech('freshness', 'quad_l', 62)).toContain('62 von 100');
  });

  it('liefert für Vorder- und Rückansicht nur die zugehörigen Regionen', () => {
    expect(regionsInView('front')).toContain('quad_l');
    expect(regionsInView('front')).not.toContain('hamstring_l');
    expect(regionsInView('back')).toContain('hamstring_l');
    expect(regionsInView('back')).not.toContain('quad_l');
  });
});
