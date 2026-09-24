import { ChallengeDef } from './types.ts';

export const EASY_CHALLENGES: ChallengeDef[] = [
  {
    id: 'EASY-01-FACTORIAL',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Off-By-One Factorial',
    slug: 'off-by-one-factorial',
    description: 'Fix the off-by-one boundary defect in factorial calculation so 5! and 10! compute correctly and unlock the flag.',
    starterCode: `public class Main {
    public static long factorial(int n) {
        if (n <= 1) return 1;
        long result = 1;
        for (int i = 2; i < n; i++) {
            result *= i;
        }
        return result;
    }

    public static void main(String[] args) {
        long f5 = factorial(5);
        long f10 = factorial(10);
        System.out.println("Computed 5!: " + f5);
        System.out.println("Computed 10!: " + f10);

        if (f5 == 120L && f10 == 3628800L) {
            long key = (f5 * 6) + 9;
            System.out.println("FLAG REVEALED: DBG{FACTORIAL_" + key + "X}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static long factorial(int n) {
        if (n <= 1) return 1;
        long result = 1;
        for (int i = 2; i <= n; i++) {
            result *= i;
        }
        return result;
    }

    public static void main(String[] args) {
        long f5 = factorial(5);
        long f10 = factorial(10);
        System.out.println("Computed 5!: " + f5);
        System.out.println("Computed 10!: " + f10);

        if (f5 == 120L && f10 == 3628800L) {
            long key = (f5 * 6) + 9;
            System.out.println("FLAG REVEALED: DBG{FACTORIAL_" + key + "X}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Off-by-one loop boundary defect: loop terminated at i < n instead of i <= n.',
    score: 10,
    displayOrder: 1,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{FACTORIAL_729X}',
    publicTestCases: [
      { inputData: '5', expectedOutput: 'Computed 5!: 120', explanation: 'Standard positive integer (5! = 120)' },
      { inputData: '1', expectedOutput: 'Computed 1!: 1', explanation: 'Base case for unit factorial (1! = 1)' },
      { inputData: '7', expectedOutput: 'Computed 7!: 5040', explanation: 'Higher positive integer factorial (7! = 5040)' },
    ],
    hiddenTestCases: [
      { inputData: '0', expectedOutput: 'Computed 0!: 1' },
      { inputData: '10', expectedOutput: 'Computed 10!: 3628800' },
      { inputData: '12', expectedOutput: 'Computed 12!: 479001600' },
    ],
  },
  {
    id: 'EASY-02-PALINDROME',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Case-Sensitive Palindrome Inversion',
    slug: 'palindrome-inversion',
    description: 'Ensure String palindrome verification ignores alphanumeric casing and whitespace to unlock the flag.',
    starterCode: `public class Main {
    public static boolean isPalindrome(String s) {
        String clean = s.replaceAll("[^a-zA-Z0-9]", "");
        return clean.equals(new StringBuilder(clean).reverse().toString());
    }

    public static void main(String[] args) {
        boolean t1 = isPalindrome("A man, a plan, a canal: Panama");
        boolean t2 = isPalindrome("race a car");
        System.out.println("Test 1: " + t1);
        System.out.println("Test 2: " + t2);

        if (t1 && !t2) {
            char[] code = new char[]{'9', '9', '2', '1', 'K'};
            System.out.println("FLAG REVEALED: DBG{PALINDROME_" + new String(code) + "}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static boolean isPalindrome(String s) {
        String clean = s.replaceAll("[^a-zA-Z0-9]", "").toLowerCase();
        return clean.equals(new StringBuilder(clean).reverse().toString());
    }

    public static void main(String[] args) {
        boolean t1 = isPalindrome("A man, a plan, a canal: Panama");
        boolean t2 = isPalindrome("race a car");
        System.out.println("Test 1: " + t1);
        System.out.println("Test 2: " + t2);

        if (t1 && !t2) {
            char[] code = new char[]{'9', '9', '2', '1', 'K'};
            System.out.println("FLAG REVEALED: DBG{PALINDROME_" + new String(code) + "}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Missing case normalization: cleaned string was not converted to lower case.',
    score: 10,
    displayOrder: 2,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{PALINDROME_9921K}',
    publicTestCases: [
      { inputData: 'A man, a plan, a canal: Panama', expectedOutput: 'Test 1: true', explanation: 'Mixed-case alphanumeric palindrome' },
      { inputData: 'race a car', expectedOutput: 'Test 2: false', explanation: 'Standard non-palindrome string' },
      { inputData: 'Was it a car or a cat I saw?', expectedOutput: 'Test 3: true', explanation: 'Sentence with punctuation and casing' },
    ],
    hiddenTestCases: [
      { inputData: "No 'x' in Nixon", expectedOutput: 'Test hidden 1: true' },
      { inputData: 'Hello, World!', expectedOutput: 'Test hidden 2: false' },
      { inputData: '12321', expectedOutput: 'Test hidden 3: true' },
    ],
  },
  {
    id: 'EASY-03-ARRAY-SUM',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Accumulator Arithmetic Type Truncation',
    slug: 'accumulator-truncation',
    description: 'Fix the integer overflow in running sum calculations over large arrays.',
    starterCode: `public class Main {
    public static long sumArray(int[] arr) {
        int total = 0;
        for (int v : arr) {
            total += v;
        }
        return total;
    }

    public static void main(String[] args) {
        int[] data = { 1000000000, 1000000000, 1000000000 };
        long res = sumArray(data);
        System.out.println("Sum result: " + res);
        if (res == 3000000000L) {
            System.out.println("FLAG REVEALED: DBG{SUM_ACCUMULATE_8812A}");
        } else {
            System.out.println("Tests failed. Integer overflow detected in accumulator.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static long sumArray(int[] arr) {
        long total = 0L;
        for (int v : arr) {
            total += v;
        }
        return total;
    }

    public static void main(String[] args) {
        int[] data = { 1000000000, 1000000000, 1000000000 };
        long res = sumArray(data);
        System.out.println("Sum result: " + res);
        if (res == 3000000000L) {
            System.out.println("FLAG REVEALED: DBG{SUM_ACCUMULATE_8812A}");
        } else {
            System.out.println("Tests failed. Integer overflow detected in accumulator.");
        }
    }
}`,
    adminNotes: 'Accumulator was 32-bit int causing overflow beyond 2.14 billion; fix with long accumulator.',
    score: 10,
    displayOrder: 3,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{SUM_ACCUMULATE_8812A}',
    publicTestCases: [
      { inputData: '[1000000000, 1000000000, 1000000000]', expectedOutput: 'Sum result: 3000000000', explanation: 'Three billion sum exceeding 32-bit integer limits' },
      { inputData: '[10, 20, 30]', expectedOutput: 'Sum result: 60', explanation: 'Small positive integer sum' },
      { inputData: '[-5, 5]', expectedOutput: 'Sum result: 0', explanation: 'Canceling positive and negative values' },
    ],
    hiddenTestCases: [
      { inputData: '[2147483647, 1]', expectedOutput: 'Sum result: 2147483648' },
      { inputData: '[]', expectedOutput: 'Sum result: 0' },
    ],
  },
  {
    id: 'EASY-04-VOWEL-REVERSE',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Vowel Reversal Two-Pointer Boundary',
    slug: 'vowel-reversal-index',
    description: 'Reverse only the vowels of a string without corrupting consonants or boundary pointers.',
    starterCode: `public class Main {
    public static String reverseVowels(String s) {
        char[] chars = s.toCharArray();
        String vowels = "aeiouAEIOU";
        int i = 0, j = chars.length - 1;
        while (i < j) {
            while (i < j && vowels.indexOf(chars[i]) == -1) i++;
            while (i < j && vowels.indexOf(chars[j]) == -1) j--;
            char tmp = chars[i];
            chars[i] = chars[j];
            chars[j] = tmp;
            // Missing inner pointer movements causes infinite loop or duplicate swap
        }
        return new String(chars);
    }

    public static void main(String[] args) {
        String out = reverseVowels("hello");
        System.out.println("Reversed: " + out);
        if ("holle".equals(out)) {
            System.out.println("FLAG REVEALED: DBG{VOWEL_REVERSAL_3194B}");
        } else {
            System.out.println("Tests failed. Keep debugging vowel reversal.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static String reverseVowels(String s) {
        char[] chars = s.toCharArray();
        String vowels = "aeiouAEIOU";
        int i = 0, j = chars.length - 1;
        while (i < j) {
            while (i < j && vowels.indexOf(chars[i]) == -1) i++;
            while (i < j && vowels.indexOf(chars[j]) == -1) j--;
            char tmp = chars[i];
            chars[i] = chars[j];
            chars[j] = tmp;
            i++;
            j--;
        }
        return new String(chars);
    }

    public static void main(String[] args) {
        String out = reverseVowels("hello");
        System.out.println("Reversed: " + out);
        if ("holle".equals(out)) {
            System.out.println("FLAG REVEALED: DBG{VOWEL_REVERSAL_3194B}");
        } else {
            System.out.println("Tests failed. Keep debugging vowel reversal.");
        }
    }
}`,
    adminNotes: 'Pointers i and j were not incremented/decremented after swapping, resulting in infinite iteration.',
    score: 10,
    displayOrder: 4,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{VOWEL_REVERSAL_3194B}',
    publicTestCases: [
      { inputData: 'hello', expectedOutput: 'Reversed: holle', explanation: 'Swaps e and o' },
      { inputData: 'leetcode', expectedOutput: 'Reversed: leotcede', explanation: 'Multiple vowel swapping' },
      { inputData: 'xyz', expectedOutput: 'Reversed: xyz', explanation: 'No vowels present in string' },
    ],
    hiddenTestCases: [
      { inputData: 'aA', expectedOutput: 'Reversed: Aa' },
      { inputData: 'racecar', expectedOutput: 'Reversed: racecar' },
    ],
  },
  {
    id: 'EASY-05-LEAP-YEAR',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Gregorian Leap Year Century Rule',
    slug: 'leap-year-century',
    description: 'Fix the leap year algorithm so that century years divisible by 100 but not 400 are correctly classified.',
    starterCode: `public class Main {
    public static boolean isLeapYear(int year) {
        // Defect: missed the century non-leap condition
        return year % 4 == 0;
    }

    public static void main(String[] args) {
        boolean y1900 = isLeapYear(1900);
        boolean y2000 = isLeapYear(2000);
        boolean y2024 = isLeapYear(2024);
        System.out.println("1900: " + y1900 + ", 2000: " + y2000 + ", 2024: " + y2024);
        if (!y1900 && y2000 && y2024) {
            System.out.println("FLAG REVEALED: DBG{LEAP_CENTURY_6711C}");
        } else {
            System.out.println("Tests failed. Century leap rule defect present.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static boolean isLeapYear(int year) {
        return (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
    }

    public static void main(String[] args) {
        boolean y1900 = isLeapYear(1900);
        boolean y2000 = isLeapYear(2000);
        boolean y2024 = isLeapYear(2024);
        System.out.println("1900: " + y1900 + ", 2000: " + y2000 + ", 2024: " + y2024);
        if (!y1900 && y2000 && y2024) {
            System.out.println("FLAG REVEALED: DBG{LEAP_CENTURY_6711C}");
        } else {
            System.out.println("Tests failed. Century leap rule defect present.");
        }
    }
}`,
    adminNotes: 'Years divisible by 100 are not leap years unless divisible by 400.',
    score: 10,
    displayOrder: 5,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{LEAP_CENTURY_6711C}',
    publicTestCases: [
      { inputData: '1900, 2000, 2024', expectedOutput: '1900: false, 2000: true, 2024: true', explanation: '1900 is not leap, 2000 is leap, 2024 is standard leap' },
      { inputData: '2023', expectedOutput: '2023: false', explanation: 'Standard non-leap year' },
      { inputData: '1600', expectedOutput: '1600: true', explanation: '400-year century leap year' },
    ],
    hiddenTestCases: [
      { inputData: '2100', expectedOutput: '2100: false' },
      { inputData: '2400', expectedOutput: '2400: true' },
    ],
  },
  {
    id: 'EASY-06-EVEN-ODD',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Negative Modulo Bitwise Parity',
    slug: 'negative-modulo-parity',
    description: 'Fix the integer parity checker so negative numbers like -3 are recognized as odd.',
    starterCode: `public class Main {
    public static boolean isOdd(int n) {
        // In Java, -3 % 2 == -1, not 1!
        return n % 2 == 1;
    }

    public static void main(String[] args) {
        boolean p3 = isOdd(3);
        boolean n3 = isOdd(-3);
        boolean p4 = isOdd(4);
        System.out.println("3 is odd: " + p3 + ", -3 is odd: " + n3 + ", 4 is odd: " + p4);
        if (p3 && n3 && !p4) {
            System.out.println("FLAG REVEALED: DBG{MODULO_PARITY_4502D}");
        } else {
            System.out.println("Tests failed. Negative odd number failed parity check.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static boolean isOdd(int n) {
        return n % 2 != 0;
    }

    public static void main(String[] args) {
        boolean p3 = isOdd(3);
        boolean n3 = isOdd(-3);
        boolean p4 = isOdd(4);
        System.out.println("3 is odd: " + p3 + ", -3 is odd: " + n3 + ", 4 is odd: " + p4);
        if (p3 && n3 && !p4) {
            System.out.println("FLAG REVEALED: DBG{MODULO_PARITY_4502D}");
        } else {
            System.out.println("Tests failed. Negative odd number failed parity check.");
        }
    }
}`,
    adminNotes: 'Java remainder preserves sign of dividend, so negative odd remainder is -1. Use n % 2 != 0 or (n & 1) != 0.',
    score: 10,
    displayOrder: 6,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{MODULO_PARITY_4502D}',
    publicTestCases: [
      { inputData: '3, -3, 4', expectedOutput: '3 is odd: true, -3 is odd: true, 4 is odd: false', explanation: 'Positive and negative odd parity with even rejection' },
      { inputData: '0', expectedOutput: '0 is odd: false', explanation: 'Zero is even' },
      { inputData: '-2', expectedOutput: '-2 is odd: false', explanation: 'Negative even number' },
    ],
    hiddenTestCases: [
      { inputData: '-999', expectedOutput: '-999 is odd: true' },
      { inputData: '1000000', expectedOutput: '1000000 is odd: false' },
    ],
  },
  {
    id: 'EASY-07-STRING-EQUALS',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'String Reference Equality Trap',
    slug: 'string-reference-equality',
    description: 'Fix string equality verification to compare string values rather than heap object identities.',
    starterCode: `public class Main {
    public static boolean verifyToken(String userProvided, String expected) {
        // Bug: using == compares references, failing dynamically generated strings
        return userProvided == expected;
    }

    public static void main(String[] args) {
        String s1 = new String("SNIPER_ACCESS");
        String s2 = "SNIPER_ACCESS";
        boolean match = verifyToken(s1, s2);
        System.out.println("Token verification: " + match);
        if (match) {
            System.out.println("FLAG REVEALED: DBG{STRING_EQUALS_9013E}");
        } else {
            System.out.println("Tests failed. Reference identity mismatch detected.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static boolean verifyToken(String userProvided, String expected) {
        return userProvided != null && userProvided.equals(expected);
    }

    public static void main(String[] args) {
        String s1 = new String("SNIPER_ACCESS");
        String s2 = "SNIPER_ACCESS";
        boolean match = verifyToken(s1, s2);
        System.out.println("Token verification: " + match);
        if (match) {
            System.out.println("FLAG REVEALED: DBG{STRING_EQUALS_9013E}");
        } else {
            System.out.println("Tests failed. Reference identity mismatch detected.");
        }
    }
}`,
    adminNotes: 'Using == on Object references compares memory locations instead of string contents.',
    score: 10,
    displayOrder: 7,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{STRING_EQUALS_9013E}',
    publicTestCases: [
      { inputData: 'new String("SNIPER_ACCESS"), "SNIPER_ACCESS"', expectedOutput: 'Token verification (match): true', explanation: 'Heap-allocated string compared to literal constant' },
      { inputData: '"ACCESS", "DENIED"', expectedOutput: 'Token verification (mismatch): false', explanation: 'Distinct strings' },
      { inputData: 'null, "ACCESS"', expectedOutput: 'Token verification (null): false', explanation: 'Null input safety' },
    ],
    hiddenTestCases: [
      { inputData: '"TOKEN", "TOKEN"', expectedOutput: 'Token verification: true' },
      { inputData: '"ADMIN", "admin"', expectedOutput: 'Token verification: false' },
    ],
  },
  {
    id: 'EASY-08-ARRAY-REVERSE',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'In-Place Array Reversal Bounds',
    slug: 'inplace-array-reversal',
    description: 'Fix the in-place array reversal loop boundary so elements are not swapped twice back to original positions.',
    starterCode: `import java.util.Arrays;

public class Main {
    public static void reverse(int[] arr) {
        int n = arr.length;
        // Bug: iterating up to n swaps elements back to their initial spots
        for (int i = 0; i < n; i++) {
            int temp = arr[i];
            arr[i] = arr[n - 1 - i];
            arr[n - 1 - i] = temp;
        }
    }

    public static void main(String[] args) {
        int[] arr = { 1, 2, 3, 4, 5 };
        reverse(arr);
        System.out.println("Reversed array: " + Arrays.toString(arr));
        if (Arrays.equals(arr, new int[]{ 5, 4, 3, 2, 1 })) {
            System.out.println("FLAG REVEALED: DBG{ARRAY_REVERSE_2348F}");
        } else {
            System.out.println("Tests failed. Double swap resulted in original array.");
        }
    }
}`,
    solutionCode: `import java.util.Arrays;

public class Main {
    public static void reverse(int[] arr) {
        int n = arr.length;
        for (int i = 0; i < n / 2; i++) {
            int temp = arr[i];
            arr[i] = arr[n - 1 - i];
            arr[n - 1 - i] = temp;
        }
    }

    public static void main(String[] args) {
        int[] arr = { 1, 2, 3, 4, 5 };
        reverse(arr);
        System.out.println("Reversed array: " + Arrays.toString(arr));
        if (Arrays.equals(arr, new int[]{ 5, 4, 3, 2, 1 })) {
            System.out.println("FLAG REVEALED: DBG{ARRAY_REVERSE_2348F}");
        } else {
            System.out.println("Tests failed. Double swap resulted in original array.");
        }
    }
}`,
    adminNotes: 'Loop ran to n instead of n / 2, undoing each swap during the second half of iteration.',
    score: 10,
    displayOrder: 8,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{ARRAY_REVERSE_2348F}',
    publicTestCases: [
      { inputData: '[1, 2, 3, 4, 5]', expectedOutput: 'Reversed array: [5, 4, 3, 2, 1]', explanation: 'Odd-length integer array reversal' },
      { inputData: '[10, 20]', expectedOutput: 'Reversed array: [20, 10]', explanation: 'Two-element array reversal' },
      { inputData: '[42]', expectedOutput: 'Reversed array: [42]', explanation: 'Single-element array invariance' },
    ],
    hiddenTestCases: [
      { inputData: '[1, 2, 3, 4]', expectedOutput: 'Reversed array: [4, 3, 2, 1]' },
      { inputData: '[]', expectedOutput: 'Reversed array: []' },
    ],
  },
  {
    id: 'EASY-09-ANAGRAM-CHECK',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Anagram Letter Frequency Counting',
    slug: 'anagram-frequency-bounds',
    description: 'Fix the letter frequency count array to properly normalize lowercase letters without ArrayIndexOutOfBoundsException.',
    starterCode: `public class Main {
    public static boolean isAnagram(String s, String t) {
        if (s.length() != t.length()) return false;
        int[] counts = new int[26];
        for (int i = 0; i < s.length(); i++) {
            // Bug: using raw char value as index causes index 97+ on size-26 array
            counts[s.charAt(i)]++;
            counts[t.charAt(i)]--;
        }
        for (int c : counts) {
            if (c != 0) return false;
        }
        return true;
    }

    public static void main(String[] args) {
        try {
            boolean r = isAnagram("listen", "silent");
            System.out.println("Anagram check: " + r);
            if (r) {
                System.out.println("FLAG REVEALED: DBG{ANAGRAM_FREQ_7741G}");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    solutionCode: `public class Main {
    public static boolean isAnagram(String s, String t) {
        if (s.length() != t.length()) return false;
        int[] counts = new int[26];
        for (int i = 0; i < s.length(); i++) {
            counts[s.charAt(i) - 'a']++;
            counts[t.charAt(i) - 'a']--;
        }
        for (int c : counts) {
            if (c != 0) return false;
        }
        return true;
    }

    public static void main(String[] args) {
        try {
            boolean r = isAnagram("listen", "silent");
            System.out.println("Anagram check: " + r);
            if (r) {
                System.out.println("FLAG REVEALED: DBG{ANAGRAM_FREQ_7741G}");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    adminNotes: "Forgot to subtract 'a' from character index, causing out of bounds exception on array of size 26.",
    score: 10,
    displayOrder: 9,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{ANAGRAM_FREQ_7741G}',
    publicTestCases: [
      { inputData: '"listen", "silent"', expectedOutput: 'Anagram check (valid pair): true', explanation: 'Standard anagram pair' },
      { inputData: '"rat", "car"', expectedOutput: 'Anagram check (letter mismatch): false', explanation: 'Different letter counts' },
      { inputData: '"a", "b"', expectedOutput: 'Anagram check (single char mismatch): false', explanation: 'Single character mismatch' },
    ],
    hiddenTestCases: [
      { inputData: '"anagram", "nagaram"', expectedOutput: 'Anagram check: true' },
      { inputData: '"ab", "a"', expectedOutput: 'Anagram check: false' },
    ],
  },
  {
    id: 'EASY-10-FIBONACCI-MEMO',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Fibonacci Base Case Zero',
    slug: 'fibonacci-base-zero',
    description: 'Fix the Fibonacci sequence base condition so fib(0) evaluates to 0 rather than 1.',
    starterCode: `public class Main {
    public static int fib(int n) {
        // Bug: fib(0) returns 1 incorrectly
        if (n <= 1) return 1;
        int a = 0, b = 1;
        for (int i = 2; i <= n; i++) {
            int c = a + b;
            a = b;
            b = c;
        }
        return b;
    }

    public static void main(String[] args) {
        int f0 = fib(0);
        int f1 = fib(1);
        int f6 = fib(6);
        System.out.println("fib(0)=" + f0 + ", fib(1)=" + f1 + ", fib(6)=" + f6);
        if (f0 == 0 && f1 == 1 && f6 == 8) {
            System.out.println("FLAG REVEALED: DBG{FIB_BASE_ZERO_1189H}");
        } else {
            System.out.println("Tests failed. Base case fib(0) returned non-zero value.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static int fib(int n) {
        if (n <= 0) return 0;
        if (n == 1) return 1;
        int a = 0, b = 1;
        for (int i = 2; i <= n; i++) {
            int c = a + b;
            a = b;
            b = c;
        }
        return b;
    }

    public static void main(String[] args) {
        int f0 = fib(0);
        int f1 = fib(1);
        int f6 = fib(6);
        System.out.println("fib(0)=" + f0 + ", fib(1)=" + f1 + ", fib(6)=" + f6);
        if (f0 == 0 && f1 == 1 && f6 == 8) {
            System.out.println("FLAG REVEALED: DBG{FIB_BASE_ZERO_1189H}");
        } else {
            System.out.println("Tests failed. Base case fib(0) returned non-zero value.");
        }
    }
}`,
    adminNotes: 'Base condition returned 1 for both n=0 and n=1; standard Fibonacci definition has fib(0)=0.',
    score: 10,
    displayOrder: 10,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{FIB_BASE_ZERO_1189H}',
    publicTestCases: [
      { inputData: '0, 1, 6', expectedOutput: 'fib(0)=0, fib(1)=1, fib(6)=8', explanation: 'Verifies fib(0)=0, fib(1)=1, and fib(6)=8' },
      { inputData: '2', expectedOutput: 'fib(2)=1', explanation: 'First sum after base cases' },
      { inputData: '5', expectedOutput: 'fib(5)=5', explanation: 'Known Fibonacci equality where fib(5) == 5' },
    ],
    hiddenTestCases: [
      { inputData: '10', expectedOutput: 'fib(10)=55' },
      { inputData: '12', expectedOutput: 'fib(12)=144' },
    ],
  },
  {
    id: 'EASY-11-MAX-ELEMENT',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Negative Array Maximum Initializer',
    slug: 'max-element-negative-init',
    description: 'Fix the maximum value search function so arrays containing only negative integers return the correct max.',
    starterCode: `public class Main {
    public static int findMax(int[] arr) {
        // Bug: Initializing to 0 fails when all values in array are negative
        int max = 0;
        for (int v : arr) {
            if (v > max) max = v;
        }
        return max;
    }

    public static void main(String[] args) {
        int[] negatives = { -15, -3, -8, -22 };
        int res = findMax(negatives);
        System.out.println("Max negative: " + res);
        if (res == -3) {
            System.out.println("FLAG REVEALED: DBG{MAX_INIT_NEG_5621I}");
        } else {
            System.out.println("Tests failed. Expected -3 but got " + res);
        }
    }
}`,
    solutionCode: `public class Main {
    public static int findMax(int[] arr) {
        int max = arr[0];
        for (int i = 1; i < arr.length; i++) {
            if (arr[i] > max) max = arr[i];
        }
        return max;
    }

    public static void main(String[] args) {
        int[] negatives = { -15, -3, -8, -22 };
        int res = findMax(negatives);
        System.out.println("Max negative: " + res);
        if (res == -3) {
            System.out.println("FLAG REVEALED: DBG{MAX_INIT_NEG_5621I}");
        } else {
            System.out.println("Tests failed. Expected -3 but got " + res);
        }
    }
}`,
    adminNotes: 'Max initialized to 0 instead of Integer.MIN_VALUE or arr[0], producing 0 on all-negative array.',
    score: 10,
    displayOrder: 11,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{MAX_INIT_NEG_5621I}',
    publicTestCases: [
      { inputData: '[-15, -3, -8, -22]', expectedOutput: 'Max negative: -3', explanation: 'All-negative array where maximum is -3' },
      { inputData: '[10, 45, 3]', expectedOutput: 'Max value: 45', explanation: 'Standard positive array' },
      { inputData: '[-100]', expectedOutput: 'Max value: -100', explanation: 'Single negative item array' },
    ],
    hiddenTestCases: [
      { inputData: '[-1, -2, -3]', expectedOutput: 'Max value: -1' },
      { inputData: '[0, -5, 5]', expectedOutput: 'Max value: 5' },
    ],
  },
  {
    id: 'EASY-12-SUBSTRING-INDEX',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Substring End Index Exclusion',
    slug: 'substring-end-index',
    description: 'Fix string extraction logic taking into account that String.substring(begin, end) has an exclusive end index.',
    starterCode: `public class Main {
    public static String getPrefix(String s, int length) {
        // Bug: s.substring(0, length - 1) truncates the last desired character
        return s.substring(0, length - 1);
    }

    public static void main(String[] args) {
        String sub = getPrefix("BUGRIP_TOURNAMENT", 6);
        System.out.println("Extracted prefix: " + sub);
        if ("BUGRIP".equals(sub)) {
            System.out.println("FLAG REVEALED: DBG{SUBSTRING_BOUND_3890J}");
        } else {
            System.out.println("Tests failed. Prefix dropped terminal character.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static String getPrefix(String s, int length) {
        return s.substring(0, length);
    }

    public static void main(String[] args) {
        String sub = getPrefix("BUGRIP_TOURNAMENT", 6);
        System.out.println("Extracted prefix: " + sub);
        if ("BUGRIP".equals(sub)) {
            System.out.println("FLAG REVEALED: DBG{SUBSTRING_BOUND_3890J}");
        } else {
            System.out.println("Tests failed. Prefix dropped terminal character.");
        }
    }
}`,
    adminNotes: 'Java substring end index is exclusive, so substring(0, length) correctly yields length characters.',
    score: 10,
    displayOrder: 12,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{SUBSTRING_BOUND_3890J}',
    publicTestCases: [
      { inputData: '"BUGRIP_TOURNAMENT", 6', expectedOutput: 'Extracted prefix: BUGRIP', explanation: 'Extracts 6 characters from string start' },
      { inputData: '"JAVA", 2', expectedOutput: 'Extracted prefix: JA', explanation: 'Extracts 2 characters' },
      { inputData: '"HELLO", 1', expectedOutput: 'Extracted prefix: H', explanation: 'Extracts single first character' },
    ],
    hiddenTestCases: [
      { inputData: '"TESTCASE", 8', expectedOutput: 'Extracted prefix: TESTCASE' },
      { inputData: '"DEBUG", 0', expectedOutput: 'Extracted prefix: ' },
    ],
  },
  {
    id: 'EASY-13-DUPLICATE-REMOVAL',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Sorted Array Duplicate Removal',
    slug: 'sorted-dedup-pointer',
    description: 'Fix the two-pointer in-place duplicate removal algorithm on sorted arrays.',
    starterCode: `public class Main {
    public static int removeDuplicates(int[] nums) {
        if (nums.length == 0) return 0;
        int writeIndex = 0;
        for (int i = 1; i < nums.length; i++) {
            if (nums[i] != nums[writeIndex]) {
                // Bug: writeIndex written without incrementing, overwriting first element
                nums[writeIndex] = nums[i];
            }
        }
        return writeIndex + 1;
    }

    public static void main(String[] args) {
        int[] nums = { 1, 1, 2, 2, 3 };
        int len = removeDuplicates(nums);
        System.out.println("New length: " + len + ", first 3: " + nums[0] + "," + nums[1] + "," + nums[2]);
        if (len == 3 && nums[0] == 1 && nums[1] == 2 && nums[2] == 3) {
            System.out.println("FLAG REVEALED: DBG{DEDUP_POINTER_6127K}");
        } else {
            System.out.println("Tests failed. In-place deduplication pointer corrupted array.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static int removeDuplicates(int[] nums) {
        if (nums.length == 0) return 0;
        int writeIndex = 0;
        for (int i = 1; i < nums.length; i++) {
            if (nums[i] != nums[writeIndex]) {
                writeIndex++;
                nums[writeIndex] = nums[i];
            }
        }
        return writeIndex + 1;
    }

    public static void main(String[] args) {
        int[] nums = { 1, 1, 2, 2, 3 };
        int len = removeDuplicates(nums);
        System.out.println("New length: " + len + ", first 3: " + nums[0] + "," + nums[1] + "," + nums[2]);
        if (len == 3 && nums[0] == 1 && nums[1] == 2 && nums[2] == 3) {
            System.out.println("FLAG REVEALED: DBG{DEDUP_POINTER_6127K}");
        } else {
            System.out.println("Tests failed. In-place deduplication pointer corrupted array.");
        }
    }
}`,
    adminNotes: 'writeIndex was not incremented before placing the distinct element.',
    score: 10,
    displayOrder: 13,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{DEDUP_POINTER_6127K}',
    publicTestCases: [
      { inputData: '[1, 1, 2, 2, 3]', expectedOutput: 'New length: 3, first 3: 1,2,3', explanation: 'Deduplicates sorted array with consecutive duplicates' },
      { inputData: '[1, 2, 3]', expectedOutput: 'New length: 3', explanation: 'Already distinct sorted array' },
      { inputData: '[7, 7, 7]', expectedOutput: 'New length: 1', explanation: 'Array with all identical elements' },
    ],
    hiddenTestCases: [
      { inputData: '[0, 0, 1, 1, 1, 2, 2, 3, 3, 4]', expectedOutput: 'New length: 5' },
      { inputData: '[42]', expectedOutput: 'New length: 1' },
    ],
  },
  {
    id: 'EASY-14-POWER-OF-TWO',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Bitwise Power of Two Precedence',
    slug: 'bitwise-precedence-power',
    description: 'Fix the bitwise expression precedence in power-of-two verification.',
    starterCode: `public class Main {
    public static boolean isPowerOfTwo(int n) {
        if (n <= 0) return false;
        // Bug: == has higher precedence than &, so this evaluates n & ((n - 1) == 0)
        return (n & n - 1 == 0);
    }

    public static void main(String[] args) {
        boolean p16 = isPowerOfTwo(16);
        boolean p18 = isPowerOfTwo(18);
        System.out.println("16 power of two: " + p16 + ", 18 power of two: " + p18);
        if (p16 && !p18) {
            System.out.println("FLAG REVEALED: DBG{BITWISE_PREC_9482L}");
        } else {
            System.out.println("Tests failed. Bitwise operator precedence defect detected.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static boolean isPowerOfTwo(int n) {
        if (n <= 0) return false;
        return (n & (n - 1)) == 0;
    }

    public static void main(String[] args) {
        boolean p16 = isPowerOfTwo(16);
        boolean p18 = isPowerOfTwo(18);
        System.out.println("16 power of two: " + p16 + ", 18 power of two: " + p18);
        if (p16 && !p18) {
            System.out.println("FLAG REVEALED: DBG{BITWISE_PREC_9482L}");
        } else {
            System.out.println("Tests failed. Bitwise operator precedence defect detected.");
        }
    }
}`,
    adminNotes: 'In Java, == binds tighter than &. Wrap (n & (n - 1)) in parentheses.',
    score: 10,
    displayOrder: 14,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{BITWISE_PREC_9482L}',
    publicTestCases: [
      { inputData: '16, 18', expectedOutput: '16 power of two: true, 18 power of two: false', explanation: '16 is 2^4 (power of 2), 18 is not' },
      { inputData: '1', expectedOutput: '1 power of two: true', explanation: '2^0 = 1 is power of two' },
      { inputData: '0', expectedOutput: '0 power of two: false', explanation: 'Zero is non-positive' },
    ],
    hiddenTestCases: [
      { inputData: '1024', expectedOutput: '1024 power of two: true' },
      { inputData: '1000', expectedOutput: '1000 power of two: false' },
    ],
  },
  {
    id: 'EASY-15-COUNT-DIGITS',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Zero Integer Digit Count Edge Case',
    slug: 'count-digits-zero-edge',
    description: 'Fix the integer digit counting algorithm so the number 0 is correctly counted as having 1 digit.',
    starterCode: `public class Main {
    public static int countDigits(int n) {
        int num = Math.abs(n);
        int count = 0;
        // Bug: while loop condition num > 0 never executes when input is 0
        while (num > 0) {
            count++;
            num /= 10;
        }
        return count;
    }

    public static void main(String[] args) {
        int d0 = countDigits(0);
        int d123 = countDigits(123);
        int dNeg7 = countDigits(-7);
        System.out.println("digits(0)=" + d0 + ", digits(123)=" + d123 + ", digits(-7)=" + dNeg7);
        if (d0 == 1 && d123 == 3 && dNeg7 == 1) {
            System.out.println("FLAG REVEALED: DBG{DIGIT_COUNT_7734M}");
        } else {
            System.out.println("Tests failed. Zero digit count returned 0.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static int countDigits(int n) {
        if (n == 0) return 1;
        int num = Math.abs(n);
        int count = 0;
        while (num > 0) {
            count++;
            num /= 10;
        }
        return count;
    }

    public static void main(String[] args) {
        int d0 = countDigits(0);
        int d123 = countDigits(123);
        int dNeg7 = countDigits(-7);
        System.out.println("digits(0)=" + d0 + ", digits(123)=" + d123 + ", digits(-7)=" + dNeg7);
        if (d0 == 1 && d123 == 3 && dNeg7 == 1) {
            System.out.println("FLAG REVEALED: DBG{DIGIT_COUNT_7734M}");
        } else {
            System.out.println("Tests failed. Zero digit count returned 0.");
        }
    }
}`,
    adminNotes: 'Input 0 bypassed while (num > 0) loop, returning 0 instead of 1.',
    score: 10,
    displayOrder: 15,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{DIGIT_COUNT_7734M}',
    publicTestCases: [
      { inputData: '0, 123, -7', expectedOutput: 'digits(0)=1, digits(123)=3, digits(-7)=1', explanation: 'Counts digits for zero, positive, and negative numbers' },
      { inputData: '9999', expectedOutput: 'digits(9999)=4', explanation: 'Four digit integer' },
      { inputData: '-500', expectedOutput: 'digits(-500)=3', explanation: 'Three digit negative integer' },
    ],
    hiddenTestCases: [
      { inputData: '100000', expectedOutput: 'digits(100000)=6' },
      { inputData: '9', expectedOutput: 'digits(9)=1' },
    ],
  },
];
