import type { ReactElement } from 'react'

type VegvisirStroke = {
  d: string
  delayMs: number
  durationMs: number
  id: string
  width: number
}

const vegvisirStrokes: VegvisirStroke[] = [
  // Center: one closed path, drawn all the way around.
  {
    id: 'center-ring',
    d: 'M 512 421 C 562 421 597 458 597 512 C 597 562 561 597 512 598 C 461 598 423 562 423 512 C 423 462 461 423 512 421 Z',
    width: 20,
    delayMs: 0,
    durationMs: 180
  },

  // The eight bare spokes all draw from the ring toward their endpoints.
  {
    id: 'spoke-north',
    d: 'M 512 420 C 510 352 514 249 512 112',
    width: 16,
    delayMs: 150,
    durationMs: 260
  },
  {
    id: 'spoke-north-east',
    d: 'M 579 445 C 632 392 700 326 807 217',
    width: 16,
    delayMs: 150,
    durationMs: 260
  },
  {
    id: 'spoke-east',
    d: 'M 605 512 C 698 510 808 514 914 512',
    width: 16,
    delayMs: 150,
    durationMs: 260
  },
  {
    id: 'spoke-south-east',
    d: 'M 579 579 C 643 645 709 712 827 828',
    width: 16,
    delayMs: 150,
    durationMs: 260
  },
  {
    id: 'spoke-south',
    d: 'M 512 605 C 510 670 514 751 512 843',
    width: 16,
    delayMs: 150,
    durationMs: 260
  },
  {
    id: 'spoke-south-west',
    d: 'M 445 579 C 400 627 350 678 274 756',
    width: 16,
    delayMs: 150,
    durationMs: 260
  },
  {
    id: 'spoke-west',
    d: 'M 419 512 C 330 509 220 515 114 512',
    width: 16,
    delayMs: 150,
    durationMs: 260
  },
  {
    id: 'spoke-north-west',
    d: 'M 445 445 C 398 400 340 341 267 269',
    width: 16,
    delayMs: 150,
    durationMs: 260
  },

  // First ornament row: the complete inner crescents on their respective arms.
  {
    id: 'inner-north-east-crescent-top',
    d: 'M 626 304 C 651 285 683 282 709 302',
    width: 13,
    delayMs: 390,
    durationMs: 150
  },
  {
    id: 'inner-north-east-crescent-bottom',
    d: 'M 714 304 C 743 326 751 360 731 392',
    width: 13,
    delayMs: 390,
    durationMs: 150
  },
  {
    id: 'inner-east-crescent',
    d: 'M 674 444 C 709 451 731 478 731 512 C 731 548 708 574 674 581',
    width: 16,
    delayMs: 390,
    durationMs: 170
  },
  {
    id: 'inner-south-west-crescent',
    d: 'M 335 590 C 310 614 306 652 324 680 C 349 714 394 712 426 687',
    width: 15,
    delayMs: 390,
    durationMs: 170
  },
  {
    id: 'inner-north-west-crescent',
    d: 'M 400 303 C 372 283 336 282 311 303 C 287 326 286 365 309 394',
    width: 15,
    delayMs: 390,
    durationMs: 170
  },

  // Second ornament row: complete crossbars, knots, and dots.
  {
    id: 'north-crossbar-one',
    d: 'M 478 237 C 499 234 526 240 546 237',
    width: 15,
    delayMs: 520,
    durationMs: 130
  },
  {
    id: 'north-east-dot-one',
    d: 'M 649 322 L 649.5 322',
    width: 19,
    delayMs: 520,
    durationMs: 110
  },
  {
    id: 'north-east-dot-two',
    d: 'M 697 366 L 697.5 366',
    width: 18,
    delayMs: 520,
    durationMs: 110
  },
  {
    id: 'east-knot-left',
    d: 'M 760 483 C 767 499 767 525 760 541',
    width: 11,
    delayMs: 520,
    durationMs: 130
  },
  {
    id: 'east-knot-right',
    d: 'M 779 483 C 773 500 773 525 780 542',
    width: 11,
    delayMs: 520,
    durationMs: 130
  },
  {
    id: 'south-east-crossbar-one',
    d: 'M 674 705 C 684 697 697 684 707 674',
    width: 14,
    delayMs: 520,
    durationMs: 125
  },
  {
    id: 'south-west-crossbar-one',
    d: 'M 300 676 C 313 688 326 701 338 713',
    width: 14,
    delayMs: 520,
    durationMs: 125
  },
  {
    id: 'north-west-knot-one',
    d: 'M 249 286 C 261 275 275 261 287 249',
    width: 13,
    delayMs: 520,
    durationMs: 125
  },
  {
    id: 'north-west-knot-two',
    d: 'M 244 271 C 254 261 263 252 272 244',
    width: 10,
    delayMs: 520,
    durationMs: 115
  },

  // Third ornament row: every outer ornament is still one uninterrupted path.
  {
    id: 'north-crossbar-two',
    d: 'M 478 199 C 498 196 526 201 545 199',
    width: 15,
    delayMs: 650,
    durationMs: 125
  },
  {
    id: 'north-crossbar-three',
    d: 'M 479 160 C 500 157 526 162 545 160',
    width: 14,
    delayMs: 680,
    durationMs: 125
  },
  {
    id: 'north-east-outer-horn-left',
    d: 'M 724 207 C 716 230 720 258 739 276',
    width: 14,
    delayMs: 650,
    durationMs: 145
  },
  {
    id: 'north-east-outer-horn-right',
    d: 'M 750 286 C 770 303 792 308 811 303',
    width: 13,
    delayMs: 650,
    durationMs: 145
  },
  {
    id: 'east-outer-crescent',
    d: 'M 871 443 C 835 449 810 478 810 512 C 810 548 836 575 873 581',
    width: 16,
    delayMs: 650,
    durationMs: 170
  },
  {
    id: 'south-east-crossbar-two',
    d: 'M 707 743 C 719 733 732 719 743 708',
    width: 14,
    delayMs: 650,
    durationMs: 125
  },
  {
    id: 'south-east-crossbar-three',
    d: 'M 739 777 C 751 766 764 753 775 742',
    width: 14,
    delayMs: 680,
    durationMs: 125
  },
  {
    id: 'south-west-crossbar-two',
    d: 'M 267 709 C 279 721 292 734 304 746',
    width: 14,
    delayMs: 650,
    durationMs: 125
  },
  {
    id: 'south-west-crossbar-three',
    d: 'M 234 743 C 246 755 258 768 271 780',
    width: 14,
    delayMs: 680,
    durationMs: 125
  },

  // Final artifacts: terminals, loops, forks, brackets, and hanging marks.
  {
    id: 'north-terminal-bar',
    d: 'M 436 110 C 480 113 542 107 588 110',
    width: 17,
    delayMs: 800,
    durationMs: 180
  },
  {
    id: 'north-terminal-prong-left',
    d: 'M 436 110 C 435 89 435 67 438 50',
    width: 16,
    delayMs: 800,
    durationMs: 150
  },
  {
    id: 'north-terminal-prong-middle',
    d: 'M 512 110 C 510 88 510 67 514 49',
    width: 16,
    delayMs: 800,
    durationMs: 150
  },
  {
    id: 'north-terminal-prong-right',
    d: 'M 588 110 C 589 88 588 67 585 50',
    width: 16,
    delayMs: 800,
    durationMs: 150
  },
  {
    id: 'north-east-terminal-zigzag',
    d: 'M 783 134 L 735 180 L 838 289 L 889 239',
    width: 17,
    delayMs: 800,
    durationMs: 240
  },
  {
    id: 'north-east-terminal-cross',
    d: 'M 724 208 L 838 289',
    width: 15,
    delayMs: 820,
    durationMs: 170
  },
  {
    id: 'east-terminal-bracket',
    d: 'M 968 438 C 945 436 925 437 905 438 L 904 585 C 926 585 947 584 969 586',
    width: 17,
    delayMs: 800,
    durationMs: 250
  },
  {
    id: 'south-east-terminal-zigzag',
    d: 'M 887 771 L 840 730 L 735 836 L 784 884',
    width: 17,
    delayMs: 800,
    durationMs: 240
  },
  {
    id: 'south-east-terminal-cross',
    d: 'M 750 721 L 829 800',
    width: 15,
    delayMs: 820,
    durationMs: 170
  },
  {
    id: 'south-terminal-top',
    d: 'M 368 821 C 445 819 573 821 654 821',
    width: 18,
    delayMs: 800,
    durationMs: 210
  },
  {
    id: 'south-terminal-outer-left',
    d: 'M 370 821 C 369 863 369 909 370 950',
    width: 16,
    delayMs: 820,
    durationMs: 180
  },
  {
    id: 'south-terminal-outer-right',
    d: 'M 652 821 C 653 863 651 909 651 950',
    width: 16,
    delayMs: 820,
    durationMs: 180
  },
  {
    id: 'south-terminal-inner',
    d: 'M 440 927 L 440 866 C 482 864 542 865 583 866 L 583 927',
    width: 16,
    delayMs: 820,
    durationMs: 240
  },
  {
    id: 'south-terminal-foot-left',
    d: 'M 360 951 C 367 947 375 955 381 950',
    width: 14,
    delayMs: 920,
    durationMs: 120
  },
  {
    id: 'south-terminal-foot-middle',
    d: 'M 502 951 C 509 946 517 955 524 950',
    width: 14,
    delayMs: 920,
    durationMs: 120
  },
  {
    id: 'south-terminal-foot-right',
    d: 'M 641 951 C 649 946 657 955 664 950',
    width: 14,
    delayMs: 920,
    durationMs: 120
  },
  {
    id: 'south-west-terminal-zigzag',
    d: 'M 135 783 L 236 676 L 347 781 L 238 884',
    width: 17,
    delayMs: 800,
    durationMs: 250
  },
  {
    id: 'north-west-terminal-loop',
    d: 'M 257 211 C 257 236 239 254 215 254 C 190 254 171 236 171 211 C 171 185 190 169 215 169 C 239 169 257 187 257 211 Z',
    width: 15,
    delayMs: 780,
    durationMs: 210
  },
  {
    id: 'north-west-terminal-loop-slash',
    d: 'M 186 181 C 203 201 223 223 244 243',
    width: 13,
    delayMs: 820,
    durationMs: 150
  },
  {
    id: 'north-west-terminal-zigzag',
    d: 'M 268 109 L 369 208 L 211 365 L 111 263',
    width: 17,
    delayMs: 800,
    durationMs: 250
  },
  {
    id: 'west-terminal-spine',
    d: 'M 118 375 C 116 444 120 580 118 650',
    width: 17,
    delayMs: 800,
    durationMs: 220
  },
  {
    id: 'west-terminal-bar-top',
    d: 'M 118 376 C 96 374 73 376 52 378',
    width: 15,
    delayMs: 820,
    durationMs: 145
  },
  {
    id: 'west-terminal-bar-upper',
    d: 'M 117 443 C 95 440 73 443 52 443',
    width: 15,
    delayMs: 840,
    durationMs: 145
  },
  {
    id: 'west-terminal-bar-lower',
    d: 'M 117 578 C 95 575 73 578 52 578',
    width: 15,
    delayMs: 860,
    durationMs: 145
  },
  {
    id: 'west-terminal-bar-bottom',
    d: 'M 118 650 C 95 648 73 650 52 649',
    width: 15,
    delayMs: 880,
    durationMs: 145
  }
]

export const VegvisirArt = (): ReactElement => (
  <svg
    aria-hidden="true"
    className="chat-panel__new-chat-vegvisir"
    focusable="false"
    preserveAspectRatio="xMidYMid meet"
    viewBox="0 0 1024 1024"
  >
    {vegvisirStrokes.map((stroke) => (
      <path
        className="chat-panel__new-chat-vegvisir-stroke"
        d={stroke.d}
        key={stroke.id}
        pathLength="100"
        strokeDasharray="100 100"
        strokeDashoffset="100"
        strokeWidth={stroke.width}
        style={{
          animationDelay: `${Math.round(stroke.delayMs * 1.25)}ms`,
          animationDuration: `${Math.round(stroke.durationMs * 1.25)}ms`
        }}
      />
    ))}
  </svg>
)
