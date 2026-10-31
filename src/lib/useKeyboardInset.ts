import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/**
 * How many pixels the on-screen keyboard covers at the bottom of the screen (0 when closed).
 * Bottom sheets add it as margin, so the field being typed in stays above the keyboard.
 *  - web (the installed site): the keyboard shrinks the *visual* viewport but not the layout,
 *    so fixed bottom sheets end up under it; visualViewport tells how much is hidden.
 *  - app (APK / iOS): edge-to-edge windows are not resized, so the keyboard height is used as is.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') {
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      if (!vv) return;
      const update = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
      update();
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      };
    }
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', e => setInset(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setInset(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return inset;
}
