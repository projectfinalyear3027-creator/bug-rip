import { ChallengeDef } from './types.ts';

export const MEDIUM_CHALLENGES: ChallengeDef[] = [
  {
    id: 'MEDIUM-01',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Second Largest Distinct Value',
    slug: 'second-largest-distinct-value',
    description: 'Find the second-largest DISTINCT value in an integer array. Fix the duplicate-handling defect where identical copies of the maximum value overwrite the second-largest slot to unlock the flag.',
    starterCode: `public class Main {
    public static Integer findSecondLargestDistinct(int[] arr) {
        if (arr == null || arr.length < 2) return null;
        Integer first = null;
        Integer second = null;
        for (int x : arr) {
            if (first == null || x > first) {
                second = first;
                first = x;
            } else if (second == null || x > second) {
                // Primary Bug: missing check that x != first, allowing duplicates of first to become second
                second = x;
            }
        }
        return second;
    }

    public static void main(String[] args) {
        Integer s1 = findSecondLargestDistinct(new int[]{10, 10, 8, 7, 6});
        Integer s2 = findSecondLargestDistinct(new int[]{5, 5, 5});
        Integer s3 = findSecondLargestDistinct(new int[]{1, 2, 3, 4, 5});
        Integer s4 = findSecondLargestDistinct(new int[]{-10, -5, -20, -5});

        System.out.println("Second largest 1: " + s1);
        System.out.println("Second largest 2: " + s2);
        System.out.println("Second largest 3: " + s3);
        System.out.println("Second largest 4: " + s4);

        if (s1 != null && s1 == 8 &&
            s2 == null &&
            s3 != null && s3 == 4 &&
            s4 != null && s4 == -10) {
            System.out.println("FLAG REVEALED: DBG{SECOND_DISTINCT_7731P}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static Integer findSecondLargestDistinct(int[] arr) {
        if (arr == null || arr.length < 2) return null;
        Integer first = null;
        Integer second = null;
        for (int x : arr) {
            if (first == null || x > first) {
                second = first;
                first = x;
            } else if (x != first && (second == null || x > second)) {
                second = x;
            }
        }
        return second;
    }

    public static void main(String[] args) {
        Integer s1 = findSecondLargestDistinct(new int[]{10, 10, 8, 7, 6});
        Integer s2 = findSecondLargestDistinct(new int[]{5, 5, 5});
        Integer s3 = findSecondLargestDistinct(new int[]{1, 2, 3, 4, 5});
        Integer s4 = findSecondLargestDistinct(new int[]{-10, -5, -20, -5});

        System.out.println("Second largest 1: " + s1);
        System.out.println("Second largest 2: " + s2);
        System.out.println("Second largest 3: " + s3);
        System.out.println("Second largest 4: " + s4);

        if (s1 != null && s1 == 8 &&
            s2 == null &&
            s3 != null && s3 == 4 &&
            s4 != null && s4 == -10) {
            System.out.println("FLAG REVEALED: DBG{SECOND_DISTINCT_7731P}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Duplicate check (x != first) was missing, causing duplicate maximums to become second largest.',
    score: 20,
    displayOrder: 1,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{SECOND_DISTINCT_7731P}',
    publicTestCases: [
      { inputData: '10 10 8 7 6', expectedOutput: 'Second largest 1: 8', explanation: 'Largest is 10, second largest distinct is 8' },
      { inputData: '5 5 5', expectedOutput: 'Second largest 2: null', explanation: 'All elements identical, no second distinct value' },
      { inputData: '1 2 3 4 5', expectedOutput: 'Second largest 3: 4', explanation: 'Distinct ascending array, 4 is second largest' },
    ],
    hiddenTestCases: [
      { inputData: '-10 -5 -20 -5', expectedOutput: 'Second largest 4: -10' },
      { inputData: '100 90', expectedOutput: '90' },
      { inputData: '7 7 6 6', expectedOutput: '6' },
    ],
  },
  {
    id: 'MEDIUM-02',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Move Zeroes to End',
    slug: 'move-zeroes-to-end',
    description: 'Move all zeroes to the end of the array while maintaining the relative order of non-zero elements. Fix the inverted filter condition that places zeroes at the beginning to unlock the flag.',
    starterCode: `import java.util.Arrays;

public class Main {
    public static int[] moveZeroes(int[] nums) {
        if (nums == null) return new int[0];
        int[] result = new int[nums.length];
        int writeIndex = 0;
        for (int i = 0; i < nums.length; i++) {
            // Primary Bug: condition checks nums[i] == 0 instead of != 0
            if (nums[i] == 0) {
                result[writeIndex++] = nums[i];
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[] z1 = moveZeroes(new int[]{1, 0, 2, 0, 3});
        int[] z2 = moveZeroes(new int[]{0, 1, 0, 3, 12});
        int[] z3 = moveZeroes(new int[]{4, 5, 6});

        System.out.println("Zeroes moved 1: " + Arrays.toString(z1));
        System.out.println("Zeroes moved 2: " + Arrays.toString(z2));
        System.out.println("Zeroes moved 3: " + Arrays.toString(z3));

        if (Arrays.equals(z1, new int[]{1, 2, 3, 0, 0}) &&
            Arrays.equals(z2, new int[]{1, 3, 12, 0, 0}) &&
            Arrays.equals(z3, new int[]{4, 5, 6})) {
            System.out.println("FLAG REVEALED: DBG{ZEROES_TO_END_9942Q}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `import java.util.Arrays;

public class Main {
    public static int[] moveZeroes(int[] nums) {
        if (nums == null) return new int[0];
        int[] result = new int[nums.length];
        int writeIndex = 0;
        for (int i = 0; i < nums.length; i++) {
            if (nums[i] != 0) {
                result[writeIndex++] = nums[i];
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[] z1 = moveZeroes(new int[]{1, 0, 2, 0, 3});
        int[] z2 = moveZeroes(new int[]{0, 1, 0, 3, 12});
        int[] z3 = moveZeroes(new int[]{4, 5, 6});

        System.out.println("Zeroes moved 1: " + Arrays.toString(z1));
        System.out.println("Zeroes moved 2: " + Arrays.toString(z2));
        System.out.println("Zeroes moved 3: " + Arrays.toString(z3));

        if (Arrays.equals(z1, new int[]{1, 2, 3, 0, 0}) &&
            Arrays.equals(z2, new int[]{1, 3, 12, 0, 0}) &&
            Arrays.equals(z3, new int[]{4, 5, 6})) {
            System.out.println("FLAG REVEALED: DBG{ZEROES_TO_END_9942Q}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Condition tested nums[i] == 0 instead of nums[i] != 0.',
    score: 20,
    displayOrder: 2,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{ZEROES_TO_END_9942Q}',
    publicTestCases: [
      { inputData: '1 0 2 0 3', expectedOutput: 'Zeroes moved 1: [1, 2, 3, 0, 0]', explanation: 'Non-zeroes preserved in order, zeroes at end' },
      { inputData: '0 1 0 3 12', expectedOutput: 'Zeroes moved 2: [1, 3, 12, 0, 0]', explanation: 'Leading zeroes shifted to rear' },
      { inputData: '4 5 6', expectedOutput: 'Zeroes moved 3: [4, 5, 6]', explanation: 'No zeroes in input' },
    ],
    hiddenTestCases: [
      { inputData: '0 0 1', expectedOutput: '[1, 0, 0]' },
      { inputData: '0 0 0', expectedOutput: '[0, 0, 0]' },
      { inputData: '10 0 20 0 30', expectedOutput: '[10, 20, 30, 0, 0]' },
    ],
  },
  {
    id: 'MEDIUM-03',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Frequency of Elements',
    slug: 'frequency-of-elements',
    description: 'Calculate element frequencies while preserving first-seen order using LinkedHashMap. Fix the arithmetic defect where frequency is decremented rather than incremented to unlock the flag.',
    starterCode: `import java.util.LinkedHashMap;
import java.util.Map;

public class Main {
    public static Map<Integer, Integer> getFrequencies(int[] arr) {
        Map<Integer, Integer> freq = new LinkedHashMap<>();
        if (arr == null) return freq;
        for (int x : arr) {
            // Primary Bug: decrements frequency instead of incrementing (+ 1)
            freq.put(x, freq.getOrDefault(x, 0) - 1);
        }
        return freq;
    }

    public static void main(String[] args) {
        Map<Integer, Integer> f1 = getFrequencies(new int[]{4, 5, 4, 6, 5, 4});
        Map<Integer, Integer> f2 = getFrequencies(new int[]{1, 2, 3});
        Map<Integer, Integer> f3 = getFrequencies(new int[]{7, 7, 7, 7});

        System.out.println("Frequencies 1: " + f1);
        System.out.println("Frequencies 2: " + f2);
        System.out.println("Frequencies 3: " + f3);

        if (f1.toString().equals("{4=3, 5=2, 6=1}") &&
            f2.toString().equals("{1=1, 2=1, 3=1}") &&
            f3.toString().equals("{7=4}")) {
            System.out.println("FLAG REVEALED: DBG{ELEM_FREQ_3385R}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `import java.util.LinkedHashMap;
import java.util.Map;

public class Main {
    public static Map<Integer, Integer> getFrequencies(int[] arr) {
        Map<Integer, Integer> freq = new LinkedHashMap<>();
        if (arr == null) return freq;
        for (int x : arr) {
            freq.put(x, freq.getOrDefault(x, 0) + 1);
        }
        return freq;
    }

    public static void main(String[] args) {
        Map<Integer, Integer> f1 = getFrequencies(new int[]{4, 5, 4, 6, 5, 4});
        Map<Integer, Integer> f2 = getFrequencies(new int[]{1, 2, 3});
        Map<Integer, Integer> f3 = getFrequencies(new int[]{7, 7, 7, 7});

        System.out.println("Frequencies 1: " + f1);
        System.out.println("Frequencies 2: " + f2);
        System.out.println("Frequencies 3: " + f3);

        if (f1.toString().equals("{4=3, 5=2, 6=1}") &&
            f2.toString().equals("{1=1, 2=1, 3=1}") &&
            f3.toString().equals("{7=4}")) {
            System.out.println("FLAG REVEALED: DBG{ELEM_FREQ_3385R}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Frequency map decremented value with - 1 instead of incrementing with + 1.',
    score: 20,
    displayOrder: 3,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{ELEM_FREQ_3385R}',
    publicTestCases: [
      { inputData: '4 5 4 6 5 4', expectedOutput: 'Frequencies 1: {4=3, 5=2, 6=1}', explanation: '4 occurs 3 times, 5 occurs 2 times, 6 occurs 1 time' },
      { inputData: '1 2 3', expectedOutput: 'Frequencies 2: {1=1, 2=1, 3=1}', explanation: 'All unique elements have frequency 1' },
      { inputData: '7 7 7 7', expectedOutput: 'Frequencies 3: {7=4}', explanation: 'Single value occurs 4 times' },
    ],
    hiddenTestCases: [
      { inputData: '10 20 10', expectedOutput: '{10=2, 20=1}' },
      { inputData: '99', expectedOutput: '{99=1}' },
      { inputData: '1 2 2 3 3 3', expectedOutput: '{1=1, 2=2, 3=3}' },
    ],
  },
  {
    id: 'MEDIUM-04',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Rotate Array Right',
    slug: 'rotate-array-right',
    description: 'Rotate an array right by k positions. Fix the off-by-one mapping error in index calculation (i + k - 1 instead of i + k) to unlock the flag.',
    starterCode: `import java.util.Arrays;

public class Main {
    public static int[] rotateRight(int[] a, int k) {
        if (a == null || a.length == 0) return a;
        int n = a.length;
        k = k % n;
        int[] result = new int[n];
        for (int i = 0; i < n; i++) {
            // Primary Bug: off-by-one on destination index ((i + k - 1) instead of (i + k))
            int dest = (i + k - 1 + n) % n;
            result[dest] = a[i];
        }
        return result;
    }

    public static void main(String[] args) {
        int[] r1 = rotateRight(new int[]{1, 2, 3, 4, 5}, 2);
        int[] r2 = rotateRight(new int[]{1, 2, 3, 4, 5}, 0);
        int[] r3 = rotateRight(new int[]{10, 20}, 1);

        System.out.println("Rotated 1: " + Arrays.toString(r1));
        System.out.println("Rotated 2: " + Arrays.toString(r2));
        System.out.println("Rotated 3: " + Arrays.toString(r3));

        if (Arrays.equals(r1, new int[]{4, 5, 1, 2, 3}) &&
            Arrays.equals(r2, new int[]{1, 2, 3, 4, 5}) &&
            Arrays.equals(r3, new int[]{20, 10})) {
            System.out.println("FLAG REVEALED: DBG{ROTATE_RIGHT_8814S}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `import java.util.Arrays;

public class Main {
    public static int[] rotateRight(int[] a, int k) {
        if (a == null || a.length == 0) return a;
        int n = a.length;
        k = k % n;
        int[] result = new int[n];
        for (int i = 0; i < n; i++) {
            int dest = (i + k) % n;
            result[dest] = a[i];
        }
        return result;
    }

    public static void main(String[] args) {
        int[] r1 = rotateRight(new int[]{1, 2, 3, 4, 5}, 2);
        int[] r2 = rotateRight(new int[]{1, 2, 3, 4, 5}, 0);
        int[] r3 = rotateRight(new int[]{10, 20}, 1);

        System.out.println("Rotated 1: " + Arrays.toString(r1));
        System.out.println("Rotated 2: " + Arrays.toString(r2));
        System.out.println("Rotated 3: " + Arrays.toString(r3));

        if (Arrays.equals(r1, new int[]{4, 5, 1, 2, 3}) &&
            Arrays.equals(r2, new int[]{1, 2, 3, 4, 5}) &&
            Arrays.equals(r3, new int[]{20, 10})) {
            System.out.println("FLAG REVEALED: DBG{ROTATE_RIGHT_8814S}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Destination formula had off-by-one: (i + k - 1) instead of (i + k).',
    score: 20,
    displayOrder: 4,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{ROTATE_RIGHT_8814S}',
    publicTestCases: [
      { inputData: '1 2 3 4 5 | 2', expectedOutput: 'Rotated 1: [4, 5, 1, 2, 3]', explanation: 'Rotated right by 2 positions' },
      { inputData: '1 2 3 4 5 | 0', expectedOutput: 'Rotated 2: [1, 2, 3, 4, 5]', explanation: 'Rotation by 0 leaves array unchanged' },
      { inputData: '10 20 | 1', expectedOutput: 'Rotated 3: [20, 10]', explanation: '2-element array rotated by 1 swaps elements' },
    ],
    hiddenTestCases: [
      { inputData: '1 2 3 | 3', expectedOutput: '[1, 2, 3]' },
      { inputData: '1 2 3 4 | 1', expectedOutput: '[4, 1, 2, 3]' },
      { inputData: '9 | 5', expectedOutput: '[9]' },
    ],
  },
  {
    id: 'MEDIUM-05',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Binary Search',
    slug: 'binary-search',
    description: 'Search for a target value in a sorted array using binary search. Fix the loop condition (left < right instead of left <= right) that misses checking the final remaining element to unlock the flag.',
    starterCode: `public class Main {
    public static String binarySearch(int[] arr, int target) {
        if (arr == null || arr.length == 0) return "NO";
        int left = 0;
        int right = arr.length - 1;
        // Primary Bug: left < right skips inspecting single element when left == right
        while (left < right) {
            int mid = left + (right - left) / 2;
            if (arr[mid] == target) {
                return "YES";
            } else if (arr[mid] < target) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        return "NO";
    }

    public static void main(String[] args) {
        String b1 = binarySearch(new int[]{1, 3, 5, 7, 9}, 9);
        String b2 = binarySearch(new int[]{1, 3, 5, 7, 9}, 1);
        String b3 = binarySearch(new int[]{42}, 42);
        String b4 = binarySearch(new int[]{1, 3, 5, 7, 9}, 4);

        System.out.println("Search 9 in [1,3,5,7,9]: " + b1);
        System.out.println("Search 1 in [1,3,5,7,9]: " + b2);
        System.out.println("Search 42 in [42]: " + b3);
        System.out.println("Search 4 in [1,3,5,7,9]: " + b4);

        if ("YES".equals(b1) && "YES".equals(b2) && "YES".equals(b3) && "NO".equals(b4)) {
            System.out.println("FLAG REVEALED: DBG{BIN_SEARCH_5529T}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static String binarySearch(int[] arr, int target) {
        if (arr == null || arr.length == 0) return "NO";
        int left = 0;
        int right = arr.length - 1;
        while (left <= right) {
            int mid = left + (right - left) / 2;
            if (arr[mid] == target) {
                return "YES";
            } else if (arr[mid] < target) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }
        return "NO";
    }

    public static void main(String[] args) {
        String b1 = binarySearch(new int[]{1, 3, 5, 7, 9}, 9);
        String b2 = binarySearch(new int[]{1, 3, 5, 7, 9}, 1);
        String b3 = binarySearch(new int[]{42}, 42);
        String b4 = binarySearch(new int[]{1, 3, 5, 7, 9}, 4);

        System.out.println("Search 9 in [1,3,5,7,9]: " + b1);
        System.out.println("Search 1 in [1,3,5,7,9]: " + b2);
        System.out.println("Search 42 in [42]: " + b3);
        System.out.println("Search 4 in [1,3,5,7,9]: " + b4);

        if ("YES".equals(b1) && "YES".equals(b2) && "YES".equals(b3) && "NO".equals(b4)) {
            System.out.println("FLAG REVEALED: DBG{BIN_SEARCH_5529T}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Loop condition was left < right instead of inclusive left <= right.',
    score: 20,
    displayOrder: 5,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{BIN_SEARCH_5529T}',
    publicTestCases: [
      { inputData: '1 3 5 7 9 | 9', expectedOutput: 'Search 9 in [1,3,5,7,9]: YES', explanation: 'Boundary element at right boundary' },
      { inputData: '1 3 5 7 9 | 1', expectedOutput: 'Search 1 in [1,3,5,7,9]: YES', explanation: 'Boundary element at left boundary' },
      { inputData: '42 | 42', expectedOutput: 'Search 42 in [42]: YES', explanation: 'Single element array target found' },
    ],
    hiddenTestCases: [
      { inputData: '1 3 5 7 9 | 4', expectedOutput: 'Search 4 in [1,3,5,7,9]: NO' },
      { inputData: '2 4 6 8 | 6', expectedOutput: 'YES' },
      { inputData: '10 20 30 | 5', expectedOutput: 'NO' },
    ],
  },
  {
    id: 'MEDIUM-06',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Remove Duplicate Characters',
    slug: 'remove-duplicate-characters',
    description: 'Remove repeated characters from a string while preserving first-occurrence order using HashSet. Fix the set operation bug where remove() was called instead of add() to unlock the flag.',
    starterCode: `import java.util.HashSet;
import java.util.Set;

public class Main {
    public static String removeDuplicateCharacters(String s) {
        if (s == null) return "";
        Set<Character> seen = new HashSet<>();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (!seen.contains(c)) {
                // Primary Bug: removes from set instead of adding
                seen.remove(c);
                sb.append(c);
            }
        }
        return sb.toString();
    }

    public static void main(String[] args) {
        String d1 = removeDuplicateCharacters("banana");
        String d2 = removeDuplicateCharacters("mississippi");
        String d3 = removeDuplicateCharacters("abcdef");

        System.out.println("Dedup banana: " + d1);
        System.out.println("Dedup mississippi: " + d2);
        System.out.println("Dedup abcdef: " + d3);

        if ("ban".equals(d1) && "misp".equals(d2) && "abcdef".equals(d3)) {
            System.out.println("FLAG REVEALED: DBG{DEDUP_CHARS_4470U}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `import java.util.HashSet;
import java.util.Set;

public class Main {
    public static String removeDuplicateCharacters(String s) {
        if (s == null) return "";
        Set<Character> seen = new HashSet<>();
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (!seen.contains(c)) {
                seen.add(c);
                sb.append(c);
            }
        }
        return sb.toString();
    }

    public static void main(String[] args) {
        String d1 = removeDuplicateCharacters("banana");
        String d2 = removeDuplicateCharacters("mississippi");
        String d3 = removeDuplicateCharacters("abcdef");

        System.out.println("Dedup banana: " + d1);
        System.out.println("Dedup mississippi: " + d2);
        System.out.println("Dedup abcdef: " + d3);

        if ("ban".equals(d1) && "misp".equals(d2) && "abcdef".equals(d3)) {
            System.out.println("FLAG REVEALED: DBG{DEDUP_CHARS_4470U}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Called seen.remove(c) instead of seen.add(c) inside uniqueness check.',
    score: 20,
    displayOrder: 6,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{DEDUP_CHARS_4470U}',
    publicTestCases: [
      { inputData: 'banana', expectedOutput: 'Dedup banana: ban', explanation: '"banana" with duplicates removed gives "ban"' },
      { inputData: 'mississippi', expectedOutput: 'Dedup mississippi: misp', explanation: '"mississippi" preserves first occurrences "misp"' },
      { inputData: 'abcdef', expectedOutput: 'Dedup abcdef: abcdef', explanation: 'All unique characters preserved' },
    ],
    hiddenTestCases: [
      { inputData: 'aaaa', expectedOutput: 'a' },
      { inputData: 'testing', expectedOutput: 'tesing' },
      { inputData: 'bookkeeper', expectedOutput: 'bokeper' },
    ],
  },
  {
    id: 'MEDIUM-07',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Maximum Consecutive Ones',
    slug: 'maximum-consecutive-ones',
    description: 'Find the maximum number of consecutive 1s in a binary array. Fix the reset defect where current streak is reset to 1 rather than 0 upon encountering a 0 to unlock the flag.',
    starterCode: `public class Main {
    public static int findMaxConsecutiveOnes(int[] nums) {
        if (nums == null || nums.length == 0) return 0;
        int max = 0;
        int current = 0;
        for (int x : nums) {
            if (x == 1) {
                current++;
                if (current > max) {
                    max = current;
                }
            } else {
                // Primary Bug: reset to 1 instead of 0
                current = 1;
            }
        }
        return max;
    }

    public static void main(String[] args) {
        int o1 = findMaxConsecutiveOnes(new int[]{1, 1, 0, 1, 1, 1, 0});
        int o2 = findMaxConsecutiveOnes(new int[]{0, 0, 0});
        int o3 = findMaxConsecutiveOnes(new int[]{1, 0, 1, 0, 1});
        int o4 = findMaxConsecutiveOnes(new int[]{1, 1, 1, 1});

        System.out.println("Max ones 1: " + o1);
        System.out.println("Max ones 2: " + o2);
        System.out.println("Max ones 3: " + o3);
        System.out.println("Max ones 4: " + o4);

        if (o1 == 3 && o2 == 0 && o3 == 1 && o4 == 4) {
            System.out.println("FLAG REVEALED: DBG{MAX_ONES_1198V}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static int findMaxConsecutiveOnes(int[] nums) {
        if (nums == null || nums.length == 0) return 0;
        int max = 0;
        int current = 0;
        for (int x : nums) {
            if (x == 1) {
                current++;
                if (current > max) {
                    max = current;
                }
            } else {
                current = 0;
            }
        }
        return max;
    }

    public static void main(String[] args) {
        int o1 = findMaxConsecutiveOnes(new int[]{1, 1, 0, 1, 1, 1, 0});
        int o2 = findMaxConsecutiveOnes(new int[]{0, 0, 0});
        int o3 = findMaxConsecutiveOnes(new int[]{1, 0, 1, 0, 1});
        int o4 = findMaxConsecutiveOnes(new int[]{1, 1, 1, 1});

        System.out.println("Max ones 1: " + o1);
        System.out.println("Max ones 2: " + o2);
        System.out.println("Max ones 3: " + o3);
        System.out.println("Max ones 4: " + o4);

        if (o1 == 3 && o2 == 0 && o3 == 1 && o4 == 4) {
            System.out.println("FLAG REVEALED: DBG{MAX_ONES_1198V}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Current streak counter reset to 1 instead of 0 on non-1 value.',
    score: 20,
    displayOrder: 7,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{MAX_ONES_1198V}',
    publicTestCases: [
      { inputData: '1 1 0 1 1 1 0', expectedOutput: 'Max ones 1: 3', explanation: 'Longest streak of 1s is 3' },
      { inputData: '0 0 0', expectedOutput: 'Max ones 2: 0', explanation: 'All zeroes yield 0 consecutive 1s' },
      { inputData: '1 0 1 0 1', expectedOutput: 'Max ones 3: 1', explanation: 'Alternating sequence has maximum streak 1' },
    ],
    hiddenTestCases: [
      { inputData: '1 1 1 1', expectedOutput: 'Max ones 4: 4' },
      { inputData: '0 1 1 0', expectedOutput: '2' },
      { inputData: '1', expectedOutput: '1' },
    ],
  },
  {
    id: 'MEDIUM-08',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Balanced Brackets',
    slug: 'balanced-brackets',
    description: 'Determine whether a string containing only ()[]{} has balanced brackets using a Stack. Fix the missing stack validation defect where unclosed opening brackets incorrectly return YES to unlock the flag.',
    starterCode: `import java.util.Stack;

public class Main {
    public static String isBalanced(String s) {
        if (s == null || s.isEmpty()) return "YES";
        Stack<Character> stack = new Stack<>();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '(' || c == '[' || c == '{') {
                stack.push(c);
            } else if (c == ')' || c == ']' || c == '}') {
                if (stack.isEmpty()) return "NO";
                char open = stack.pop();
                if (c == ')' && open != '(') return "NO";
                if (c == ']' && open != '[') return "NO";
                if (c == '}' && open != '{') return "NO";
            }
        }
        // Primary Bug: missing stack emptiness check (returns YES even with unclosed opening brackets)
        return "YES";
    }

    public static void main(String[] args) {
        String t1 = isBalanced("{[()]}");
        String t2 = isBalanced("([)]");
        String t3 = isBalanced("((");
        String t4 = isBalanced("()");
        String t5 = isBalanced("{[(])}");

        System.out.println("Test 1 Result: " + t1);
        System.out.println("Test 2 Result: " + t2);
        System.out.println("Test 3 Result: " + t3);
        System.out.println("Test 4 Result: " + t4);
        System.out.println("Test 5 Result: " + t5);

        if ("YES".equals(t1) && "NO".equals(t2) && "NO".equals(t3) && "YES".equals(t4) && "NO".equals(t5)) {
            System.out.println("FLAG REVEALED: DBG{BALANCED_BRACKETS_7821B}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `import java.util.Stack;

public class Main {
    public static String isBalanced(String s) {
        if (s == null || s.isEmpty()) return "YES";
        Stack<Character> stack = new Stack<>();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '(' || c == '[' || c == '{') {
                stack.push(c);
            } else if (c == ')' || c == ']' || c == '}') {
                if (stack.isEmpty()) return "NO";
                char open = stack.pop();
                if (c == ')' && open != '(') return "NO";
                if (c == ']' && open != '[') return "NO";
                if (c == '}' && open != '{') return "NO";
            }
        }
        return stack.isEmpty() ? "YES" : "NO";
    }

    public static void main(String[] args) {
        String t1 = isBalanced("{[()]}");
        String t2 = isBalanced("([)]");
        String t3 = isBalanced("((");
        String t4 = isBalanced("()");
        String t5 = isBalanced("{[(])}");

        System.out.println("Test 1 Result: " + t1);
        System.out.println("Test 2 Result: " + t2);
        System.out.println("Test 3 Result: " + t3);
        System.out.println("Test 4 Result: " + t4);
        System.out.println("Test 5 Result: " + t5);

        if ("YES".equals(t1) && "NO".equals(t2) && "NO".equals(t3) && "YES".equals(t4) && "NO".equals(t5)) {
            System.out.println("FLAG REVEALED: DBG{BALANCED_BRACKETS_7821B}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Final stack validation missing: returned YES without validating stack.isEmpty() for leftover opening brackets.',
    score: 20,
    displayOrder: 8,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{BALANCED_BRACKETS_7821B}',
    publicTestCases: [
      { inputData: '{[()]}', expectedOutput: 'Test 1 Result: YES', explanation: 'Properly nested brackets {[()]} are balanced' },
      { inputData: '([)]', expectedOutput: 'Test 2 Result: NO', explanation: 'Wrong nesting order ([)] is unbalanced' },
      { inputData: '((', expectedOutput: 'Test 3 Result: NO', explanation: 'Leftover opening brackets without closing pair' },
    ],
    hiddenTestCases: [
      { inputData: '', expectedOutput: 'YES' },
      { inputData: '()', expectedOutput: 'YES' },
      { inputData: '()[]{}', expectedOutput: 'YES' },
      { inputData: '{[()]}', expectedOutput: 'YES' },
      { inputData: '{[(])}', expectedOutput: 'NO' },
      { inputData: ')()(', expectedOutput: 'NO' },
      { inputData: '((([{}]))', expectedOutput: 'NO' },
      { inputData: '{()}[{}]', expectedOutput: 'YES' },
      { inputData: '{{[[(())]]}}', expectedOutput: 'YES' },
      { inputData: '{{[[(())]]}}{', expectedOutput: 'NO' },
    ],
  },
  {
    id: 'MEDIUM-09',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Merge Two Sorted Arrays',
    slug: 'merge-two-sorted-arrays',
    description: 'Given two individually sorted integer arrays, merge them into one sorted array using a two-pointer approach. Fix the inverted comparison condition that selects the larger element first to unlock the flag.',
    starterCode: `import java.util.Arrays;

public class Main {
    public static int[] mergeSorted(int[] a, int[] b) {
        if (a == null) a = new int[0];
        if (b == null) b = new int[0];
        int[] result = new int[a.length + b.length];
        int i = 0, j = 0, k = 0;
        while (i < a.length && j < b.length) {
            // Primary Bug: reversed comparison selects larger element first
            if (a[i] > b[j]) {
                result[k++] = a[i++];
            } else {
                result[k++] = b[j++];
            }
        }
        while (i < a.length) {
            result[k++] = a[i++];
        }
        while (j < b.length) {
            result[k++] = b[j++];
        }
        return result;
    }

    public static void main(String[] args) {
        int[] m1 = mergeSorted(new int[]{1, 3, 5}, new int[]{2, 4, 6});
        int[] m2 = mergeSorted(new int[]{1, 2, 2}, new int[]{2, 3, 4});
        int[] m3 = mergeSorted(new int[]{}, new int[]{1, 5});
        int[] m4 = mergeSorted(new int[]{5, 10}, new int[]{1, 2});

        System.out.println("Test 1 Result: " + Arrays.toString(m1));
        System.out.println("Test 2 Result: " + Arrays.toString(m2));
        System.out.println("Test 3 Result: " + Arrays.toString(m3));
        System.out.println("Test 4 Result: " + Arrays.toString(m4));

        if (Arrays.equals(m1, new int[]{1, 2, 3, 4, 5, 6}) &&
            Arrays.equals(m2, new int[]{1, 2, 2, 2, 3, 4}) &&
            Arrays.equals(m3, new int[]{1, 5}) &&
            Arrays.equals(m4, new int[]{1, 2, 5, 10})) {
            System.out.println("FLAG REVEALED: DBG{MERGE_SORTED_ARRAYS_9914M}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `import java.util.Arrays;

public class Main {
    public static int[] mergeSorted(int[] a, int[] b) {
        if (a == null) a = new int[0];
        if (b == null) b = new int[0];
        int[] result = new int[a.length + b.length];
        int i = 0, j = 0, k = 0;
        while (i < a.length && j < b.length) {
            if (a[i] <= b[j]) {
                result[k++] = a[i++];
            } else {
                result[k++] = b[j++];
            }
        }
        while (i < a.length) {
            result[k++] = a[i++];
        }
        while (j < b.length) {
            result[k++] = b[j++];
        }
        return result;
    }

    public static void main(String[] args) {
        int[] m1 = mergeSorted(new int[]{1, 3, 5}, new int[]{2, 4, 6});
        int[] m2 = mergeSorted(new int[]{1, 2, 2}, new int[]{2, 3, 4});
        int[] m3 = mergeSorted(new int[]{}, new int[]{1, 5});
        int[] m4 = mergeSorted(new int[]{5, 10}, new int[]{1, 2});

        System.out.println("Test 1 Result: " + Arrays.toString(m1));
        System.out.println("Test 2 Result: " + Arrays.toString(m2));
        System.out.println("Test 3 Result: " + Arrays.toString(m3));
        System.out.println("Test 4 Result: " + Arrays.toString(m4));

        if (Arrays.equals(m1, new int[]{1, 2, 3, 4, 5, 6}) &&
            Arrays.equals(m2, new int[]{1, 2, 2, 2, 3, 4}) &&
            Arrays.equals(m3, new int[]{1, 5}) &&
            Arrays.equals(m4, new int[]{1, 2, 5, 10})) {
            System.out.println("FLAG REVEALED: DBG{MERGE_SORTED_ARRAYS_9914M}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Comparison condition a[i] > b[j] picked larger element instead of smaller during two-pointer merge.',
    score: 20,
    displayOrder: 9,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{MERGE_SORTED_ARRAYS_9914M}',
    publicTestCases: [
      { inputData: '1 3 5 | 2 4 6', expectedOutput: 'Test 1 Result: [1, 2, 3, 4, 5, 6]', explanation: 'Interleaved merge of sorted arrays' },
      { inputData: '1 2 2 | 2 3 4', expectedOutput: 'Test 2 Result: [1, 2, 2, 2, 3, 4]', explanation: 'Merge arrays with duplicate elements' },
      { inputData: 'empty | 1 5', expectedOutput: 'Test 3 Result: [1, 5]', explanation: 'Empty first array merged with second array' },
    ],
    hiddenTestCases: [
      { inputData: '1 5 9 | 2 6 10', expectedOutput: '[1, 2, 5, 6, 9, 10]' },
      { inputData: '1 4 | 2 3 5 6 7', expectedOutput: '[1, 2, 3, 4, 5, 6, 7]' },
      { inputData: 'empty | 1 2 3', expectedOutput: '[1, 2, 3]' },
      { inputData: '1 2 2 | 2 3 4', expectedOutput: '[1, 2, 2, 2, 3, 4]' },
      { inputData: '1 2 3 | 4 5 6', expectedOutput: '[1, 2, 3, 4, 5, 6]' },
      { inputData: '4 5 6 | 1 2 3', expectedOutput: '[1, 2, 3, 4, 5, 6]' },
      { inputData: '1 3 5 7 | 2 4 6 8', expectedOutput: '[1, 2, 3, 4, 5, 6, 7, 8]' },
      { inputData: '5 5 5 | 5 5', expectedOutput: '[5, 5, 5, 5, 5]' },
      { inputData: '2 | 1', expectedOutput: '[1, 2]' },
      { inputData: '10 | 1 2 3 4 5 6 7 8 9 11', expectedOutput: '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]' },
    ],
  },
  {
    id: 'MEDIUM-10',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Longest Word',
    slug: 'longest-word',
    description: 'Find the longest word in a sentence. Fix the reversed length comparison defect that keeps the shortest word instead of the longest to unlock the flag.',
    starterCode: `public class Main {
    public static String findLongestWord(String sentence) {
        if (sentence == null || sentence.trim().isEmpty()) return "";
        String[] words = sentence.trim().split("\\\\s+");
        String longest = words[0];
        for (int i = 1; i < words.length; i++) {
            // Primary Bug: reversed comparison (< instead of >)
            if (words[i].length() < longest.length()) {
                longest = words[i];
            }
        }
        return longest;
    }

    public static void main(String[] args) {
        String w1 = findLongestWord("I love competitive programming");
        String w2 = findLongestWord("Java is powerful");
        String w3 = findLongestWord("cat dog bird fish");
        String w4 = findLongestWord("The quick brown fox jumps");

        System.out.println("Test 1 Result: " + w1);
        System.out.println("Test 2 Result: " + w2);
        System.out.println("Test 3 Result: " + w3);
        System.out.println("Test 4 Result: " + w4);

        if ("competitive".equals(w1) &&
            "powerful".equals(w2) &&
            "bird".equals(w3) &&
            "quick".equals(w4)) {
            System.out.println("FLAG REVEALED: DBG{LONGEST_WORD_4407W}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static String findLongestWord(String sentence) {
        if (sentence == null || sentence.trim().isEmpty()) return "";
        String[] words = sentence.trim().split("\\\\s+");
        String longest = words[0];
        for (int i = 1; i < words.length; i++) {
            if (words[i].length() > longest.length()) {
                longest = words[i];
            }
        }
        return longest;
    }

    public static void main(String[] args) {
        String w1 = findLongestWord("I love competitive programming");
        String w2 = findLongestWord("Java is powerful");
        String w3 = findLongestWord("cat dog bird fish");
        String w4 = findLongestWord("The quick brown fox jumps");

        System.out.println("Test 1 Result: " + w1);
        System.out.println("Test 2 Result: " + w2);
        System.out.println("Test 3 Result: " + w3);
        System.out.println("Test 4 Result: " + w4);

        if ("competitive".equals(w1) &&
            "powerful".equals(w2) &&
            "bird".equals(w3) &&
            "quick".equals(w4)) {
            System.out.println("FLAG REVEALED: DBG{LONGEST_WORD_4407W}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Comparison checked words[i].length() < longest.length() instead of >.',
    score: 20,
    displayOrder: 10,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{LONGEST_WORD_4407W}',
    publicTestCases: [
      { inputData: 'I love competitive programming', expectedOutput: 'Test 1 Result: competitive', explanation: '"competitive" (11 letters) is the first longest word encountered' },
      { inputData: 'Java is powerful', expectedOutput: 'Test 2 Result: powerful', explanation: '"powerful" (8 letters) is the longest word' },
      { inputData: 'cat dog bird fish', expectedOutput: 'Test 3 Result: bird', explanation: '"bird" (4 letters) is the first longest word on tie with fish' },
    ],
    hiddenTestCases: [
      { inputData: 'hello', expectedOutput: 'hello' },
      { inputData: 'hi there', expectedOutput: 'there' },
      { inputData: 'the red fox jumps', expectedOutput: 'jumps' },
      { inputData: 'superstar is playing', expectedOutput: 'superstar' },
      { inputData: 'we love debugging code', expectedOutput: 'debugging' },
      { inputData: 'this is fantastic', expectedOutput: 'fantastic' },
      { inputData: 'test test test', expectedOutput: 'test' },
      { inputData: 'alpha gamma delta', expectedOutput: 'alpha' },
      { inputData: 'look, here it is!', expectedOutput: 'look,' },
      { inputData: 'A quick movement by the competitive programmer solved the difficult puzzle', expectedOutput: 'competitive' },
    ],
  },
];
