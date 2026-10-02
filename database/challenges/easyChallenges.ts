import { ChallengeDef } from './types.ts';

export const EASY_CHALLENGES: ChallengeDef[] = [
  {
    id: 'EASY-01',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Sum of Even Numbers',
    slug: 'sum-of-even-numbers',
    description: 'Read n integers and compute the sum of all even numbers. Fix the for-loop boundary defect that processes n + 1 values instead of exactly n to unlock the flag.',
    starterCode: `public class Main {
    public static int sumEvenNumbers(int[] numbers) {
        if (numbers == null || numbers.length == 0) return 0;
        int sum = 0;
        // Primary Bug: loop condition processes n + 1 values (<= instead of <)
        for (int i = 0; i <= numbers.length; i++) {
            if (numbers[i] % 2 == 0) {
                sum += numbers[i];
            }
        }
        return sum;
    }

    public static void main(String[] args) {
        try {
            int t1 = sumEvenNumbers(new int[]{1, 2, 3, 4, 5, 6});
            int t2 = sumEvenNumbers(new int[]{7, 11, 13});
            int t3 = sumEvenNumbers(new int[]{2, 4, 8});
            int t4 = sumEvenNumbers(new int[]{-4, -2, 1, 3});

            System.out.println("Test 1 Result: " + t1);
            System.out.println("Test 2 Result: " + t2);
            System.out.println("Test 3 Result: " + t3);
            System.out.println("Test 4 Result: " + t4);

            if (t1 == 12 && t2 == 0 && t3 == 14 && t4 == -6) {
                System.out.println("FLAG REVEALED: DBG{EVEN_SUM_6201A}");
            } else {
                System.out.println("Tests failed. Keep debugging to unlock flag.");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    solutionCode: `public class Main {
    public static int sumEvenNumbers(int[] numbers) {
        if (numbers == null || numbers.length == 0) return 0;
        int sum = 0;
        for (int i = 0; i < numbers.length; i++) {
            if (numbers[i] % 2 == 0) {
                sum += numbers[i];
            }
        }
        return sum;
    }

    public static void main(String[] args) {
        try {
            int t1 = sumEvenNumbers(new int[]{1, 2, 3, 4, 5, 6});
            int t2 = sumEvenNumbers(new int[]{7, 11, 13});
            int t3 = sumEvenNumbers(new int[]{2, 4, 8});
            int t4 = sumEvenNumbers(new int[]{-4, -2, 1, 3});

            System.out.println("Test 1 Result: " + t1);
            System.out.println("Test 2 Result: " + t2);
            System.out.println("Test 3 Result: " + t3);
            System.out.println("Test 4 Result: " + t4);

            if (t1 == 12 && t2 == 0 && t3 == 14 && t4 == -6) {
                System.out.println("FLAG REVEALED: DBG{EVEN_SUM_6201A}");
            } else {
                System.out.println("Tests failed. Keep debugging to unlock flag.");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    adminNotes: 'Loop boundary off-by-one: loop index ran i <= numbers.length causing ArrayIndexOutOfBoundsException.',
    score: 10,
    displayOrder: 1,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{EVEN_SUM_6201A}',
    publicTestCases: [
      { inputData: '1 2 3 4 5 6', expectedOutput: 'Test 1 Result: 12', explanation: 'Mixed even and odd integers (2 + 4 + 6 = 12)' },
      { inputData: '7 11 13', expectedOutput: 'Test 2 Result: 0', explanation: 'All odd integers yield sum of 0' },
      { inputData: '2 4 8', expectedOutput: 'Test 3 Result: 14', explanation: 'All even integers (2 + 4 + 8 = 14)' },
    ],
    hiddenTestCases: [
      { inputData: '-4 -2 1 3', expectedOutput: 'Test 4 Result: -6' },
      { inputData: '0', expectedOutput: '0' },
      { inputData: '100 200 301', expectedOutput: '300' },
    ],
  },
  {
    id: 'EASY-02',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Find the Largest Number',
    slug: 'find-the-largest-number',
    description: 'Read n integers and find the largest value. Fix the inverted comparison condition that picks the smallest number instead of the largest to unlock the flag.',
    starterCode: `public class Main {
    public static int findLargest(int[] arr) {
        if (arr == null || arr.length == 0) return 0;
        int largest = arr[0];
        for (int i = 1; i < arr.length; i++) {
            // Primary Bug: comparison operator is inverted (< instead of >)
            if (arr[i] < largest) {
                largest = arr[i];
            }
        }
        return largest;
    }

    public static void main(String[] args) {
        int m1 = findLargest(new int[]{3, 7, 2, 9, 5});
        int m2 = findLargest(new int[]{-10, -3, -50, -1});
        int m3 = findLargest(new int[]{42});

        System.out.println("Largest 1: " + m1);
        System.out.println("Largest 2: " + m2);
        System.out.println("Largest 3: " + m3);

        if (m1 == 9 && m2 == -1 && m3 == 42) {
            System.out.println("FLAG REVEALED: DBG{LARGEST_NUM_4819B}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static int findLargest(int[] arr) {
        if (arr == null || arr.length == 0) return 0;
        int largest = arr[0];
        for (int i = 1; i < arr.length; i++) {
            if (arr[i] > largest) {
                largest = arr[i];
            }
        }
        return largest;
    }

    public static void main(String[] args) {
        int m1 = findLargest(new int[]{3, 7, 2, 9, 5});
        int m2 = findLargest(new int[]{-10, -3, -50, -1});
        int m3 = findLargest(new int[]{42});

        System.out.println("Largest 1: " + m1);
        System.out.println("Largest 2: " + m2);
        System.out.println("Largest 3: " + m3);

        if (m1 == 9 && m2 == -1 && m3 == 42) {
            System.out.println("FLAG REVEALED: DBG{LARGEST_NUM_4819B}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Comparison condition was inverted from > to <, finding the minimum instead of maximum.',
    score: 10,
    displayOrder: 2,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{LARGEST_NUM_4819B}',
    publicTestCases: [
      { inputData: '3 7 2 9 5', expectedOutput: 'Largest 1: 9', explanation: 'Array with positive numbers, 9 is largest' },
      { inputData: '-10 -3 -50 -1', expectedOutput: 'Largest 2: -1', explanation: 'Array with negative numbers, -1 is largest' },
      { inputData: '42', expectedOutput: 'Largest 3: 42', explanation: 'Single element array' },
    ],
    hiddenTestCases: [
      { inputData: '100 20 500 40', expectedOutput: '500' },
      { inputData: '-5 -5 -5', expectedOutput: '-5' },
      { inputData: '0 -10 -20', expectedOutput: '0' },
    ],
  },
  {
    id: 'EASY-03',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Count Positive Numbers',
    slug: 'count-positive-numbers',
    description: 'Count how many integers in an array are strictly greater than zero. Fix the inverted condition that counts negative numbers instead of positive numbers to unlock the flag.',
    starterCode: `public class Main {
    public static int countPositive(int[] arr) {
        if (arr == null) return 0;
        int count = 0;
        for (int x : arr) {
            // Primary Bug: condition checks for x < 0 instead of x > 0
            if (x < 0) {
                count++;
            }
        }
        return count;
    }

    public static void main(String[] args) {
        int c1 = countPositive(new int[]{4, -2, 0, 7, -9, 3});
        int c2 = countPositive(new int[]{-1, -2, -3});
        int c3 = countPositive(new int[]{0, 0, 0});

        System.out.println("Count 1: " + c1);
        System.out.println("Count 2: " + c2);
        System.out.println("Count 3: " + c3);

        if (c1 == 3 && c2 == 0 && c3 == 0) {
            System.out.println("FLAG REVEALED: DBG{POS_COUNT_7392C}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static int countPositive(int[] arr) {
        if (arr == null) return 0;
        int count = 0;
        for (int x : arr) {
            if (x > 0) {
                count++;
            }
        }
        return count;
    }

    public static void main(String[] args) {
        int c1 = countPositive(new int[]{4, -2, 0, 7, -9, 3});
        int c2 = countPositive(new int[]{-1, -2, -3});
        int c3 = countPositive(new int[]{0, 0, 0});

        System.out.println("Count 1: " + c1);
        System.out.println("Count 2: " + c2);
        System.out.println("Count 3: " + c3);

        if (c1 == 3 && c2 == 0 && c3 == 0) {
            System.out.println("FLAG REVEALED: DBG{POS_COUNT_7392C}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Condition checked x < 0 instead of x > 0.',
    score: 10,
    displayOrder: 3,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{POS_COUNT_7392C}',
    publicTestCases: [
      { inputData: '4 -2 0 7 -9 3', expectedOutput: 'Count 1: 3', explanation: 'Positive numbers are 4, 7, 3 (total: 3)' },
      { inputData: '-1 -2 -3', expectedOutput: 'Count 2: 0', explanation: 'All negative numbers, count is 0' },
      { inputData: '0 0 0', expectedOutput: 'Count 3: 0', explanation: 'Zero is neither positive nor negative' },
    ],
    hiddenTestCases: [
      { inputData: '1 2 3 4 5', expectedOutput: '5' },
      { inputData: '-10 10', expectedOutput: '1' },
      { inputData: '100', expectedOutput: '1' },
    ],
  },
  {
    id: 'EASY-04',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Reverse a Number',
    slug: 'reverse-a-number',
    description: 'Reverse the digits of an integer. Fix the accumulation defect where the remaining number was appended instead of the extracted digit to unlock the flag.',
    starterCode: `public class Main {
    public static int reverseNumber(int n) {
        int reversed = 0;
        int num = Math.abs(n);
        while (num > 0) {
            int digit = num % 10;
            // Primary Bug: appends num instead of digit
            reversed = reversed * 10 + num;
            num /= 10;
        }
        return n < 0 ? -reversed : reversed;
    }

    public static void main(String[] args) {
        int r1 = reverseNumber(12345);
        int r2 = reverseNumber(-987);
        int r3 = reverseNumber(100);

        System.out.println("Reversed 1: " + r1);
        System.out.println("Reversed 2: " + r2);
        System.out.println("Reversed 3: " + r3);

        if (r1 == 54321 && r2 == -789 && r3 == 1) {
            System.out.println("FLAG REVEALED: DBG{REV_NUM_1948D}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static int reverseNumber(int n) {
        int reversed = 0;
        int num = Math.abs(n);
        while (num > 0) {
            int digit = num % 10;
            reversed = reversed * 10 + digit;
            num /= 10;
        }
        return n < 0 ? -reversed : reversed;
    }

    public static void main(String[] args) {
        int r1 = reverseNumber(12345);
        int r2 = reverseNumber(-987);
        int r3 = reverseNumber(100);

        System.out.println("Reversed 1: " + r1);
        System.out.println("Reversed 2: " + r2);
        System.out.println("Reversed 3: " + r3);

        if (r1 == 54321 && r2 == -789 && r3 == 1) {
            System.out.println("FLAG REVEALED: DBG{REV_NUM_1948D}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Reversal math appended num rather than extracted digit.',
    score: 10,
    displayOrder: 4,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{REV_NUM_1948D}',
    publicTestCases: [
      { inputData: '12345', expectedOutput: 'Reversed 1: 54321', explanation: 'Digits reversed 12345 -> 54321' },
      { inputData: '-987', expectedOutput: 'Reversed 2: -789', explanation: 'Negative number preservation -987 -> -789' },
      { inputData: '100', expectedOutput: 'Reversed 3: 1', explanation: 'Trailing zeroes stripped upon reversal 100 -> 1' },
    ],
    hiddenTestCases: [
      { inputData: '7', expectedOutput: '7' },
      { inputData: '405', expectedOutput: '504' },
      { inputData: '-120', expectedOutput: '-21' },
    ],
  },
  {
    id: 'EASY-05',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Count Vowels',
    slug: 'count-vowels',
    description: 'Count the number of vowels (a, e, i, o, u) in a lowercase string. Fix the vowel condition check where an invalid character was checked instead of "u" to unlock the flag.',
    starterCode: `public class Main {
    public static int countVowels(String s) {
        if (s == null) return 0;
        int count = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            // Primary Bug: 'y' is tested instead of 'u'
            if (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'y') {
                count++;
            }
        }
        return count;
    }

    public static void main(String[] args) {
        int v1 = countVowels("education");
        int v2 = countVowels("sky rhythm");
        int v3 = countVowels("algorithm");

        System.out.println("Vowels in education: " + v1);
        System.out.println("Vowels in sky rhythm: " + v2);
        System.out.println("Vowels in algorithm: " + v3);

        if (v1 == 5 && v2 == 0 && v3 == 3) {
            System.out.println("FLAG REVEALED: DBG{VOWEL_SCAN_8820E}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static int countVowels(String s) {
        if (s == null) return 0;
        int count = 0;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u') {
                count++;
            }
        }
        return count;
    }

    public static void main(String[] args) {
        int v1 = countVowels("education");
        int v2 = countVowels("sky rhythm");
        int v3 = countVowels("algorithm");

        System.out.println("Vowels in education: " + v1);
        System.out.println("Vowels in sky rhythm: " + v2);
        System.out.println("Vowels in algorithm: " + v3);

        if (v1 == 5 && v2 == 0 && v3 == 3) {
            System.out.println("FLAG REVEALED: DBG{VOWEL_SCAN_8820E}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Vowel check included y instead of u.',
    score: 10,
    displayOrder: 5,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{VOWEL_SCAN_8820E}',
    publicTestCases: [
      { inputData: 'education', expectedOutput: 'Vowels in education: 5', explanation: 'Contains e, u, a, i, o (all 5 vowels)' },
      { inputData: 'sky rhythm', expectedOutput: 'Vowels in sky rhythm: 0', explanation: 'No standard vowels present' },
      { inputData: 'algorithm', expectedOutput: 'Vowels in algorithm: 3', explanation: 'Contains a, o, i (3 vowels)' },
    ],
    hiddenTestCases: [
      { inputData: 'umbrella', expectedOutput: '3' },
      { inputData: 'crypt', expectedOutput: '0' },
      { inputData: 'aeiou', expectedOutput: '5' },
    ],
  },
  {
    id: 'EASY-06',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Multiplication Table',
    slug: 'multiplication-table',
    description: 'Compute the first n multiples of x (x*1, x*2, ..., x*n). Fix the loop boundary that stops at n - 1 instead of including n to unlock the flag.',
    starterCode: `import java.util.Arrays;

public class Main {
    public static int[] getMultiples(int x, int n) {
        if (n <= 0) return new int[0];
        int[] result = new int[n];
        // Primary Bug: stops at n - 1 (i < n instead of i <= n)
        for (int i = 1; i < n; i++) {
            result[i - 1] = x * i;
        }
        return result;
    }

    public static void main(String[] args) {
        int[] m1 = getMultiples(3, 5);
        int[] m2 = getMultiples(7, 3);
        int[] m3 = getMultiples(10, 1);

        System.out.println("Multiples 3x5: " + Arrays.toString(m1));
        System.out.println("Multiples 7x3: " + Arrays.toString(m2));
        System.out.println("Multiples 10x1: " + Arrays.toString(m3));

        if (Arrays.equals(m1, new int[]{3, 6, 9, 12, 15}) &&
            Arrays.equals(m2, new int[]{7, 14, 21}) &&
            Arrays.equals(m3, new int[]{10})) {
            System.out.println("FLAG REVEALED: DBG{MULT_TABLE_3317F}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `import java.util.Arrays;

public class Main {
    public static int[] getMultiples(int x, int n) {
        if (n <= 0) return new int[0];
        int[] result = new int[n];
        for (int i = 1; i <= n; i++) {
            result[i - 1] = x * i;
        }
        return result;
    }

    public static void main(String[] args) {
        int[] m1 = getMultiples(3, 5);
        int[] m2 = getMultiples(7, 3);
        int[] m3 = getMultiples(10, 1);

        System.out.println("Multiples 3x5: " + Arrays.toString(m1));
        System.out.println("Multiples 7x3: " + Arrays.toString(m2));
        System.out.println("Multiples 10x1: " + Arrays.toString(m3));

        if (Arrays.equals(m1, new int[]{3, 6, 9, 12, 15}) &&
            Arrays.equals(m2, new int[]{7, 14, 21}) &&
            Arrays.equals(m3, new int[]{10})) {
            System.out.println("FLAG REVEALED: DBG{MULT_TABLE_3317F}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Loop stopped at i < n instead of i <= n, leaving final entry 0.',
    score: 10,
    displayOrder: 6,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{MULT_TABLE_3317F}',
    publicTestCases: [
      { inputData: '3 5', expectedOutput: 'Multiples 3x5: [3, 6, 9, 12, 15]', explanation: 'First 5 multiples of 3' },
      { inputData: '7 3', expectedOutput: 'Multiples 7x3: [7, 14, 21]', explanation: 'First 3 multiples of 7' },
      { inputData: '10 1', expectedOutput: 'Multiples 10x1: [10]', explanation: 'Single multiple of 10' },
    ],
    hiddenTestCases: [
      { inputData: '4 4', expectedOutput: '[4, 8, 12, 16]' },
      { inputData: '9 2', expectedOutput: '[9, 18]' },
      { inputData: '2 6', expectedOutput: '[2, 4, 6, 8, 10, 12]' },
    ],
  },
  {
    id: 'EASY-07',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Array Average',
    slug: 'array-average',
    description: 'Calculate the decimal average of an array of integers as a double. Fix the integer division bug that truncates decimal portions to unlock the flag.',
    starterCode: `public class Main {
    public static double calculateAverage(int[] arr) {
        if (arr == null || arr.length == 0) return 0.0;
        int sum = 0;
        for (int x : arr) {
            sum += x;
        }
        // Primary Bug: integer division sum / arr.length truncates fractional average
        return sum / arr.length;
    }

    public static void main(String[] args) {
        double a1 = calculateAverage(new int[]{1, 2});
        double a2 = calculateAverage(new int[]{10, 20, 30, 40});
        double a3 = calculateAverage(new int[]{5, 6, 7, 8});

        System.out.printf("Avg 1: %.1f%n", a1);
        System.out.printf("Avg 2: %.1f%n", a2);
        System.out.printf("Avg 3: %.1f%n", a3);

        if (Math.abs(a1 - 1.5) < 0.001 && Math.abs(a2 - 25.0) < 0.001 && Math.abs(a3 - 6.5) < 0.001) {
            System.out.println("FLAG REVEALED: DBG{ARRAY_AVG_9024G}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static double calculateAverage(int[] arr) {
        if (arr == null || arr.length == 0) return 0.0;
        int sum = 0;
        for (int x : arr) {
            sum += x;
        }
        return (double) sum / arr.length;
    }

    public static void main(String[] args) {
        double a1 = calculateAverage(new int[]{1, 2});
        double a2 = calculateAverage(new int[]{10, 20, 30, 40});
        double a3 = calculateAverage(new int[]{5, 6, 7, 8});

        System.out.printf("Avg 1: %.1f%n", a1);
        System.out.printf("Avg 2: %.1f%n", a2);
        System.out.printf("Avg 3: %.1f%n", a3);

        if (Math.abs(a1 - 1.5) < 0.001 && Math.abs(a2 - 25.0) < 0.001 && Math.abs(a3 - 6.5) < 0.001) {
            System.out.println("FLAG REVEALED: DBG{ARRAY_AVG_9024G}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Integer division sum / arr.length lost fractional precision.',
    score: 10,
    displayOrder: 7,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{ARRAY_AVG_9024G}',
    publicTestCases: [
      { inputData: '1 2', expectedOutput: 'Avg 1: 1.5', explanation: 'Average of 1 and 2 is 1.5' },
      { inputData: '10 20 30 40', expectedOutput: 'Avg 2: 25.0', explanation: 'Average of 10, 20, 30, 40 is 25.0' },
      { inputData: '5 6 7 8', expectedOutput: 'Avg 3: 6.5', explanation: 'Average of 5, 6, 7, 8 is 6.5' },
    ],
    hiddenTestCases: [
      { inputData: '3 4', expectedOutput: '3.5' },
      { inputData: '1 1 2', expectedOutput: '1.33' },
      { inputData: '0 0 1', expectedOutput: '0.33' },
    ],
  },
  {
    id: 'EASY-08',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Replace Negative Values',
    slug: 'replace-negative-values',
    description: 'Replace every negative value with 0 in an integer array. Fix the reversed condition that zeroes positive values instead of negative values to unlock the flag.',
    starterCode: `import java.util.Arrays;

public class Main {
    public static int[] replaceNegatives(int[] arr) {
        if (arr == null) return new int[0];
        int[] result = arr.clone();
        for (int i = 0; i < result.length; i++) {
            // Primary Bug: reversed comparison replaces positive values with 0
            if (result[i] > 0) {
                result[i] = 0;
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[] r1 = replaceNegatives(new int[]{-1, 2, -3, 4, 0});
        int[] r2 = replaceNegatives(new int[]{-5, -10});
        int[] r3 = replaceNegatives(new int[]{7, 8, 9});

        System.out.println("Replaced 1: " + Arrays.toString(r1));
        System.out.println("Replaced 2: " + Arrays.toString(r2));
        System.out.println("Replaced 3: " + Arrays.toString(r3));

        if (Arrays.equals(r1, new int[]{0, 2, 0, 4, 0}) &&
            Arrays.equals(r2, new int[]{0, 0}) &&
            Arrays.equals(r3, new int[]{7, 8, 9})) {
            System.out.println("FLAG REVEALED: DBG{REP_NEG_5516H}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `import java.util.Arrays;

public class Main {
    public static int[] replaceNegatives(int[] arr) {
        if (arr == null) return new int[0];
        int[] result = arr.clone();
        for (int i = 0; i < result.length; i++) {
            if (result[i] < 0) {
                result[i] = 0;
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[] r1 = replaceNegatives(new int[]{-1, 2, -3, 4, 0});
        int[] r2 = replaceNegatives(new int[]{-5, -10});
        int[] r3 = replaceNegatives(new int[]{7, 8, 9});

        System.out.println("Replaced 1: " + Arrays.toString(r1));
        System.out.println("Replaced 2: " + Arrays.toString(r2));
        System.out.println("Replaced 3: " + Arrays.toString(r3));

        if (Arrays.equals(r1, new int[]{0, 2, 0, 4, 0}) &&
            Arrays.equals(r2, new int[]{0, 0}) &&
            Arrays.equals(r3, new int[]{7, 8, 9})) {
            System.out.println("FLAG REVEALED: DBG{REP_NEG_5516H}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Condition tested result[i] > 0 instead of result[i] < 0.',
    score: 10,
    displayOrder: 8,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{REP_NEG_5516H}',
    publicTestCases: [
      { inputData: '-1 2 -3 4 0', expectedOutput: 'Replaced 1: [0, 2, 0, 4, 0]', explanation: '-1 and -3 replaced with 0' },
      { inputData: '-5 -10', expectedOutput: 'Replaced 2: [0, 0]', explanation: 'All negatives replaced with 0' },
      { inputData: '7 8 9', expectedOutput: 'Replaced 3: [7, 8, 9]', explanation: 'No negatives, array remains unchanged' },
    ],
    hiddenTestCases: [
      { inputData: '-99 100', expectedOutput: '[0, 100]' },
      { inputData: '0 -1', expectedOutput: '[0, 0]' },
      { inputData: '-2 -4 -6', expectedOutput: '[0, 0, 0]' },
    ],
  },
  {
    id: 'EASY-09',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'First Character',
    slug: 'first-character',
    description: 'Retrieve the first character of a non-empty string. Fix the indexing defect where s.length() is passed instead of index 0 to unlock the flag.',
    starterCode: `public class Main {
    public static char getFirstCharacter(String s) {
        if (s == null || s.isEmpty()) return ' ';
        // Primary Bug: uses s.length() causing StringIndexOutOfBoundsException
        return s.charAt(s.length());
    }

    public static void main(String[] args) {
        try {
            char c1 = getFirstCharacter("Debugging");
            char c2 = getFirstCharacter("Java");
            char c3 = getFirstCharacter("BugSniper");

            System.out.println("First in Debugging: " + c1);
            System.out.println("First in Java: " + c2);
            System.out.println("First in BugSniper: " + c3);

            if (c1 == 'D' && c2 == 'J' && c3 == 'B') {
                System.out.println("FLAG REVEALED: DBG{FIRST_CHAR_2741I}");
            } else {
                System.out.println("Tests failed. Keep debugging to unlock flag.");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    solutionCode: `public class Main {
    public static char getFirstCharacter(String s) {
        if (s == null || s.isEmpty()) return ' ';
        return s.charAt(0);
    }

    public static void main(String[] args) {
        try {
            char c1 = getFirstCharacter("Debugging");
            char c2 = getFirstCharacter("Java");
            char c3 = getFirstCharacter("BugSniper");

            System.out.println("First in Debugging: " + c1);
            System.out.println("First in Java: " + c2);
            System.out.println("First in BugSniper: " + c3);

            if (c1 == 'D' && c2 == 'J' && c3 == 'B') {
                System.out.println("FLAG REVEALED: DBG{FIRST_CHAR_2741I}");
            } else {
                System.out.println("Tests failed. Keep debugging to unlock flag.");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    adminNotes: 'Accessed charAt(s.length()) instead of charAt(0).',
    score: 10,
    displayOrder: 9,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{FIRST_CHAR_2741I}',
    publicTestCases: [
      { inputData: 'Debugging', expectedOutput: 'First in Debugging: D', explanation: 'First character of "Debugging" is D' },
      { inputData: 'Java', expectedOutput: 'First in Java: J', explanation: 'First character of "Java" is J' },
      { inputData: 'BugSniper', expectedOutput: 'First in BugSniper: B', explanation: 'First character of "BugSniper" is B' },
    ],
    hiddenTestCases: [
      { inputData: 'X', expectedOutput: 'X' },
      { inputData: 'hello', expectedOutput: 'h' },
      { inputData: '123', expectedOutput: '1' },
    ],
  },
  {
    id: 'EASY-10',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Celsius to Fahrenheit',
    slug: 'celsius-to-fahrenheit',
    description: 'Convert temperature from Celsius to Fahrenheit using F = C * 9 / 5 + 32. Fix the sign defect where 32 is subtracted instead of added to unlock the flag.',
    starterCode: `public class Main {
    public static double celsiusToFahrenheit(double c) {
        // Primary Bug: subtracts 32 instead of adding 32
        return (c * 9.0 / 5.0) - 32.0;
    }

    public static void main(String[] args) {
        double f1 = celsiusToFahrenheit(0);
        double f2 = celsiusToFahrenheit(100);
        double f3 = celsiusToFahrenheit(-40);

        System.out.printf("0C in F: %.1f%n", f1);
        System.out.printf("100C in F: %.1f%n", f2);
        System.out.printf(" -40C in F: %.1f%n", f3);

        if (Math.abs(f1 - 32.0) < 0.001 && Math.abs(f2 - 212.0) < 0.001 && Math.abs(f3 - (-40.0)) < 0.001) {
            System.out.println("FLAG REVEALED: DBG{CELSIUS_FAHR_6183J}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static double celsiusToFahrenheit(double c) {
        return (c * 9.0 / 5.0) + 32.0;
    }

    public static void main(String[] args) {
        double f1 = celsiusToFahrenheit(0);
        double f2 = celsiusToFahrenheit(100);
        double f3 = celsiusToFahrenheit(-40);

        System.out.printf("0C in F: %.1f%n", f1);
        System.out.printf("100C in F: %.1f%n", f2);
        System.out.printf(" -40C in F: %.1f%n", f3);

        if (Math.abs(f1 - 32.0) < 0.001 && Math.abs(f2 - 212.0) < 0.001 && Math.abs(f3 - (-40.0)) < 0.001) {
            System.out.println("FLAG REVEALED: DBG{CELSIUS_FAHR_6183J}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Formula subtracted 32 instead of adding 32.',
    score: 10,
    displayOrder: 10,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{CELSIUS_FAHR_6183J}',
    publicTestCases: [
      { inputData: '0', expectedOutput: '0C in F: 32.0', explanation: 'Freezing point of water: 0 C = 32 F' },
      { inputData: '100', expectedOutput: '100C in F: 212.0', explanation: 'Boiling point of water: 100 C = 212 F' },
      { inputData: '-40', expectedOutput: ' -40C in F: -40.0', explanation: 'Scales intersect at -40' },
    ],
    hiddenTestCases: [
      { inputData: '25', expectedOutput: '77.0' },
      { inputData: '37', expectedOutput: '98.6' },
      { inputData: '-10', expectedOutput: '14.0' },
    ],
  },
  {
    id: 'EASY-11',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Count Digits',
    slug: 'count-digits',
    description: 'Count the number of digits in an integer. Fix the edge-case handling for 0 where the while loop fails to execute and returns 0 digits instead of 1 to unlock the flag.',
    starterCode: `public class Main {
    public static int countDigits(int n) {
        int count = 0;
        int num = Math.abs(n);
        // Primary Bug: when n is 0, the loop does not execute and returns 0 instead of 1
        while (num > 0) {
            count++;
            num /= 10;
        }
        return count;
    }

    public static void main(String[] args) {
        int d1 = countDigits(0);
        int d2 = countDigits(12345);
        int d3 = countDigits(-9876);

        System.out.println("Digits in 0: " + d1);
        System.out.println("Digits in 12345: " + d2);
        System.out.println("Digits in -9876: " + d3);

        if (d1 == 1 && d2 == 5 && d3 == 4) {
            System.out.println("FLAG REVEALED: DBG{DIGIT_LEN_9935K}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static int countDigits(int n) {
        if (n == 0) return 1;
        int count = 0;
        int num = Math.abs(n);
        while (num > 0) {
            count++;
            num /= 10;
        }
        return count;
    }

    public static void main(String[] args) {
        int d1 = countDigits(0);
        int d2 = countDigits(12345);
        int d3 = countDigits(-9876);

        System.out.println("Digits in 0: " + d1);
        System.out.println("Digits in 12345: " + d2);
        System.out.println("Digits in -9876: " + d3);

        if (d1 == 1 && d2 == 5 && d3 == 4) {
            System.out.println("FLAG REVEALED: DBG{DIGIT_LEN_9935K}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Zero was reported as 0 digits instead of 1 digit.',
    score: 10,
    displayOrder: 11,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{DIGIT_LEN_9935K}',
    publicTestCases: [
      { inputData: '0', expectedOutput: 'Digits in 0: 1', explanation: 'The number 0 has exactly 1 digit' },
      { inputData: '12345', expectedOutput: 'Digits in 12345: 5', explanation: '12345 has 5 digits' },
      { inputData: '-9876', expectedOutput: 'Digits in -9876: 4', explanation: 'Negative sign excluded; -9876 has 4 digits' },
    ],
    hiddenTestCases: [
      { inputData: '1000', expectedOutput: '4' },
      { inputData: '-5', expectedOutput: '1' },
      { inputData: '999999', expectedOutput: '6' },
    ],
  },
  {
    id: 'EASY-12',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Swap Two Numbers',
    slug: 'swap-two-numbers',
    description: 'Swap two integers using a standard temporary variable. Fix the incorrect assignment order where the second variable receives an already overwritten value to unlock the flag.',
    starterCode: `import java.util.Arrays;

public class Main {
    public static int[] swapNumbers(int a, int b) {
        int temp = a;
        a = b;
        // Primary Bug: b assigned from overwritten a instead of temp
        b = a;
        return new int[]{a, b};
    }

    public static void main(String[] args) {
        int[] s1 = swapNumbers(10, 20);
        int[] s2 = swapNumbers(5, -3);
        int[] s3 = swapNumbers(0, 100);

        System.out.println("Swapped 10, 20: " + Arrays.toString(s1));
        System.out.println("Swapped 5, -3: " + Arrays.toString(s2));
        System.out.println("Swapped 0, 100: " + Arrays.toString(s3));

        if (Arrays.equals(s1, new int[]{20, 10}) &&
            Arrays.equals(s2, new int[]{-3, 5}) &&
            Arrays.equals(s3, new int[]{100, 0})) {
            System.out.println("FLAG REVEALED: DBG{SWAP_VALS_4207L}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `import java.util.Arrays;

public class Main {
    public static int[] swapNumbers(int a, int b) {
        int temp = a;
        a = b;
        b = temp;
        return new int[]{a, b};
    }

    public static void main(String[] args) {
        int[] s1 = swapNumbers(10, 20);
        int[] s2 = swapNumbers(5, -3);
        int[] s3 = swapNumbers(0, 100);

        System.out.println("Swapped 10, 20: " + Arrays.toString(s1));
        System.out.println("Swapped 5, -3: " + Arrays.toString(s2));
        System.out.println("Swapped 0, 100: " + Arrays.toString(s3));

        if (Arrays.equals(s1, new int[]{20, 10}) &&
            Arrays.equals(s2, new int[]{-3, 5}) &&
            Arrays.equals(s3, new int[]{100, 0})) {
            System.out.println("FLAG REVEALED: DBG{SWAP_VALS_4207L}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'b was assigned from a instead of temp, leaving both values equal.',
    score: 10,
    displayOrder: 12,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{SWAP_VALS_4207L}',
    publicTestCases: [
      { inputData: '10 20', expectedOutput: 'Swapped 10, 20: [20, 10]', explanation: '10 and 20 are swapped' },
      { inputData: '5 -3', expectedOutput: 'Swapped 5, -3: [-3, 5]', explanation: '5 and -3 are swapped' },
      { inputData: '0 100', expectedOutput: 'Swapped 0, 100: [100, 0]', explanation: '0 and 100 are swapped' },
    ],
    hiddenTestCases: [
      { inputData: '7 7', expectedOutput: '[7, 7]' },
      { inputData: '-15 -30', expectedOutput: '[-30, -15]' },
      { inputData: '42 99', expectedOutput: '[99, 42]' },
    ],
  },
  {
    id: 'EASY-13',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Search an Array',
    slug: 'search-an-array',
    description: 'Check if a target integer exists within an array and return YES if found, otherwise NO. Fix the reversed comparison condition that tests x != target to unlock the flag.',
    starterCode: `public class Main {
    public static String searchArray(int[] arr, int target) {
        if (arr == null) return "NO";
        for (int x : arr) {
            // Primary Bug: condition is reversed (!= instead of ==)
            if (x != target) {
                return "YES";
            }
        }
        return "NO";
    }

    public static void main(String[] args) {
        String s1 = searchArray(new int[]{1, 3, 5, 7}, 5);
        String s2 = searchArray(new int[]{1, 3, 5, 7}, 9);
        String s3 = searchArray(new int[]{}, 42);

        System.out.println("Search 5 in [1,3,5,7]: " + s1);
        System.out.println("Search 9 in [1,3,5,7]: " + s2);
        System.out.println("Search 42 in empty: " + s3);

        if ("YES".equals(s1) && "NO".equals(s2) && "NO".equals(s3)) {
            System.out.println("FLAG REVEALED: DBG{ARRAY_SRCH_8312M}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static String searchArray(int[] arr, int target) {
        if (arr == null) return "NO";
        for (int x : arr) {
            if (x == target) {
                return "YES";
            }
        }
        return "NO";
    }

    public static void main(String[] args) {
        String s1 = searchArray(new int[]{1, 3, 5, 7}, 5);
        String s2 = searchArray(new int[]{1, 3, 5, 7}, 9);
        String s3 = searchArray(new int[]{}, 42);

        System.out.println("Search 5 in [1,3,5,7]: " + s1);
        System.out.println("Search 9 in [1,3,5,7]: " + s2);
        System.out.println("Search 42 in empty: " + s3);

        if ("YES".equals(s1) && "NO".equals(s2) && "NO".equals(s3)) {
            System.out.println("FLAG REVEALED: DBG{ARRAY_SRCH_8312M}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Condition checked x != target instead of x == target.',
    score: 10,
    displayOrder: 13,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{ARRAY_SRCH_8312M}',
    publicTestCases: [
      { inputData: '1 3 5 7 | 5', expectedOutput: 'Search 5 in [1,3,5,7]: YES', explanation: '5 exists in array' },
      { inputData: '1 3 5 7 | 9', expectedOutput: 'Search 9 in [1,3,5,7]: NO', explanation: '9 does not exist in array' },
      { inputData: 'empty | 42', expectedOutput: 'Search 42 in empty: NO', explanation: 'Empty array returns NO' },
    ],
    hiddenTestCases: [
      { inputData: '10 20 30 | 20', expectedOutput: 'YES' },
      { inputData: '4 8 12 | 1', expectedOutput: 'NO' },
      { inputData: '-5 0 5 | -5', expectedOutput: 'YES' },
    ],
  },
  {
    id: 'EASY-14',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Remove Spaces',
    slug: 'remove-spaces',
    description: 'Remove all standard space characters from a string. Fix the replacement bug where spaces are replaced with underscores instead of being stripped to unlock the flag.',
    starterCode: `public class Main {
    public static String removeSpaces(String s) {
        if (s == null) return "";
        // Primary Bug: replaces space with underscore instead of empty string
        return s.replace(" ", "_");
    }

    public static void main(String[] args) {
        String str1 = removeSpaces("hello world");
        String str2 = removeSpaces(" b u g   s n i p e r ");
        String str3 = removeSpaces("nospaces");

        System.out.println("Clean 1: " + str1);
        System.out.println("Clean 2: " + str2);
        System.out.println("Clean 3: " + str3);

        if ("helloworld".equals(str1) && "bugsniper".equals(str2) && "nospaces".equals(str3)) {
            System.out.println("FLAG REVEALED: DBG{NO_SPACES_5749N}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static String removeSpaces(String s) {
        if (s == null) return "";
        return s.replace(" ", "");
    }

    public static void main(String[] args) {
        String str1 = removeSpaces("hello world");
        String str2 = removeSpaces(" b u g   s n i p e r ");
        String str3 = removeSpaces("nospaces");

        System.out.println("Clean 1: " + str1);
        System.out.println("Clean 2: " + str2);
        System.out.println("Clean 3: " + str3);

        if ("helloworld".equals(str1) && "bugsniper".equals(str2) && "nospaces".equals(str3)) {
            System.out.println("FLAG REVEALED: DBG{NO_SPACES_5749N}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Replaced spaces with "_" instead of removing them with "".',
    score: 10,
    displayOrder: 14,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{NO_SPACES_5749N}',
    publicTestCases: [
      { inputData: 'hello world', expectedOutput: 'Clean 1: helloworld', explanation: 'Single space removed: "hello world" -> "helloworld"' },
      { inputData: ' b u g   s n i p e r ', expectedOutput: 'Clean 2: bugsniper', explanation: 'All spaces removed: " b u g   s n i p e r " -> "bugsniper"' },
      { inputData: 'nospaces', expectedOutput: 'Clean 3: nospaces', explanation: 'No spaces present, string remains unchanged' },
    ],
    hiddenTestCases: [
      { inputData: 'a b c', expectedOutput: 'abc' },
      { inputData: '   ', expectedOutput: '' },
      { inputData: 'java  ctf', expectedOutput: 'javactf' },
    ],
  },
  {
    id: 'EASY-15',
    roundSlug: 'easy',
    difficulty: 'EASY',
    title: 'Simple Grade Calculator',
    slug: 'simple-grade-calculator',
    description: 'Calculate letter grades based on scores: 90+ -> A, 75-89 -> B, 60-74 -> C, <60 -> D. Fix the swapped branch conditions for C and D to unlock the flag.',
    starterCode: `public class Main {
    public static String calculateGrade(int score) {
        if (score >= 90) {
            return "A";
        } else if (score >= 75) {
            return "B";
        } else if (score < 60) {
            // Primary Bug: swapped C and D conditions
            return "C";
        } else {
            return "D";
        }
    }

    public static void main(String[] args) {
        String g1 = calculateGrade(95);
        String g2 = calculateGrade(80);
        String g3 = calculateGrade(65);
        String g4 = calculateGrade(45);

        System.out.println("Grade 95: " + g1);
        System.out.println("Grade 80: " + g2);
        System.out.println("Grade 65: " + g3);
        System.out.println("Grade 45: " + g4);

        if ("A".equals(g1) && "B".equals(g2) && "C".equals(g3) && "D".equals(g4)) {
            System.out.println("FLAG REVEALED: DBG{GRADE_CALC_1628O}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static String calculateGrade(int score) {
        if (score >= 90) {
            return "A";
        } else if (score >= 75) {
            return "B";
        } else if (score >= 60) {
            return "C";
        } else {
            return "D";
        }
    }

    public static void main(String[] args) {
        String g1 = calculateGrade(95);
        String g2 = calculateGrade(80);
        String g3 = calculateGrade(65);
        String g4 = calculateGrade(45);

        System.out.println("Grade 95: " + g1);
        System.out.println("Grade 80: " + g2);
        System.out.println("Grade 65: " + g3);
        System.out.println("Grade 45: " + g4);

        if ("A".equals(g1) && "B".equals(g2) && "C".equals(g3) && "D".equals(g4)) {
            System.out.println("FLAG REVEALED: DBG{GRADE_CALC_1628O}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Branches for grades C and D were swapped in conditional cascade.',
    score: 10,
    displayOrder: 15,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{GRADE_CALC_1628O}',
    publicTestCases: [
      { inputData: '95', expectedOutput: 'Grade 95: A', explanation: 'Score 95 receives grade A (>= 90)' },
      { inputData: '80', expectedOutput: 'Grade 80: B', explanation: 'Score 80 receives grade B (75-89)' },
      { inputData: '65', expectedOutput: 'Grade 65: C', explanation: 'Score 65 receives grade C (60-74)' },
    ],
    hiddenTestCases: [
      { inputData: '45', expectedOutput: 'Grade 45: D' },
      { inputData: '60', expectedOutput: 'C' },
      { inputData: '59', expectedOutput: 'D' },
    ],
  },
];
