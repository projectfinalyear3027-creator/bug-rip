import { ChallengeDef } from './types.ts';

export const MEDIUM_CHALLENGES: ChallengeDef[] = [
  {
    id: 'MEDIUM-01-BINARY-SEARCH',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Integer Overflow Binary Search',
    slug: 'binary-search-overflow',
    description: 'Fix the mid index calculation integer overflow bug (low + high) / 2 in massive arrays to reveal the flag.',
    starterCode: `public class Main {
    public static int search(int[] nums, int target) {
        int low = 0, high = nums.length - 1;
        while (low <= high) {
            int mid = (low + high) / 2;
            if (nums[mid] == target) return mid;
            if (nums[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        return -1;
    }

    public static void main(String[] args) {
        int[] arr = new int[]{1, 3, 5, 7, 9, 11, 45, 99};
        int idx = search(arr, 45);
        System.out.println("Search result for 45: " + idx);

        if (idx == 6) {
            int code = 5514;
            System.out.println("FLAG REVEALED: DBG{BINARY_SEARCH_" + code + "M}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    solutionCode: `public class Main {
    public static int search(int[] nums, int target) {
        int low = 0, high = nums.length - 1;
        while (low <= high) {
            int mid = low + (high - low) / 2;
            if (nums[mid] == target) return mid;
            if (nums[mid] < target) low = mid + 1;
            else high = mid - 1;
        }
        return -1;
    }

    public static void main(String[] args) {
        int[] arr = new int[]{1, 3, 5, 7, 9, 11, 45, 99};
        int idx = search(arr, 45);
        System.out.println("Search result for 45: " + idx);

        if (idx == 6) {
            int code = 5514;
            System.out.println("FLAG REVEALED: DBG{BINARY_SEARCH_" + code + "M}");
        } else {
            System.out.println("Tests failed. Keep debugging to unlock flag.");
        }
    }
}`,
    adminNotes: 'Integer overflow defect: (low + high) / 2 overflows when low + high > Integer.MAX_VALUE. Fix using low + (high - low) / 2.',
    score: 20,
    displayOrder: 1,
    validationType: 'TEST_CASE_VALIDATION',
    flag: 'DBG{BINARY_SEARCH_5514M}',
    publicTestCases: [
      { inputData: 'nums=[1, 3, 5, 7, 9, 11, 45, 99], target=45', expectedOutput: 'Search result for 45: 6', explanation: 'Target 45 found at index 6' },
      { inputData: 'nums=[1, 3, 5, 7, 9, 11, 45, 99], target=1', expectedOutput: 'Search result for 1: 0', explanation: 'Target 1 found at index 0' },
      { inputData: 'nums=[1, 3, 5, 7, 9, 11, 45, 99], target=100', expectedOutput: 'Search result for 100: -1', explanation: 'Target 100 exceeds array elements' },
    ],
    hiddenTestCases: [
      { inputData: 'nums=[-5, 0, 12, 45, 99], target=45', expectedOutput: 'Search result for 45: 3' },
      { inputData: 'nums=[2, 4, 6, 8, 10], target=6', expectedOutput: 'Search result for 6: 2' },
    ],
  },
  {
    id: 'MEDIUM-02-MERGE-INTERVALS',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Unsorted Interval Merging Defect',
    slug: 'merge-intervals-unsorted',
    description: 'Fix interval merging to sort input intervals by start time before executing overlap reduction.',
    starterCode: `import java.util.*;

public class Main {
    public static List<int[]> merge(int[][] intervals) {
        if (intervals.length <= 1) return Arrays.asList(intervals);
        // Bug: intervals are not sorted by start time, missing overlapping disjoint items
        List<int[]> result = new ArrayList<>();
        int[] current = intervals[0];
        result.add(current);

        for (int i = 1; i < intervals.length; i++) {
            int[] next = intervals[i];
            if (current[1] >= next[0]) {
                current[1] = Math.max(current[1], next[1]);
            } else {
                current = next;
                result.add(current);
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[][] intervals = { { 8, 10 }, { 1, 3 }, { 2, 6 }, { 15, 18 } };
        List<int[]> merged = merge(intervals);
        System.out.println("Merged count: " + merged.size());
        if (merged.size() == 3) {
            System.out.println("FLAG REVEALED: DBG{INTERVAL_MERGE_4491N}");
        } else {
            System.out.println("Tests failed. Unsorted interval input produced faulty merge.");
        }
    }
}`,
    solutionCode: `import java.util.*;

public class Main {
    public static List<int[]> merge(int[][] intervals) {
        if (intervals.length <= 1) return Arrays.asList(intervals);
        Arrays.sort(intervals, Comparator.comparingInt(a -> a[0]));
        List<int[]> result = new ArrayList<>();
        int[] current = intervals[0];
        result.add(current);

        for (int i = 1; i < intervals.length; i++) {
            int[] next = intervals[i];
            if (current[1] >= next[0]) {
                current[1] = Math.max(current[1], next[1]);
            } else {
                current = next;
                result.add(current);
            }
        }
        return result;
    }

    public static void main(String[] args) {
        int[][] intervals = { { 8, 10 }, { 1, 3 }, { 2, 6 }, { 15, 18 } };
        List<int[]> merged = merge(intervals);
        System.out.println("Merged count: " + merged.size());
        if (merged.size() == 3) {
            System.out.println("FLAG REVEALED: DBG{INTERVAL_MERGE_4491N}");
        } else {
            System.out.println("Tests failed. Unsorted interval input produced faulty merge.");
        }
    }
}`,
    adminNotes: 'Intervals must be sorted by start coordinate before linear merging.',
    score: 20,
    displayOrder: 2,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{INTERVAL_MERGE_4491N}',
    publicTestCases: [
      { inputData: '[[8,10],[1,3],[2,6],[15,18]]', expectedOutput: 'Merged count: 3', explanation: '[1,3] and [2,6] merge into [1,6]' },
      { inputData: '[[1,4],[4,5]]', expectedOutput: 'Merged count: 1', explanation: 'Adjacent touching intervals merge' },
      { inputData: '[[1,2],[3,4]]', expectedOutput: 'Merged count: 2', explanation: 'Disjoint non-touching intervals remain separate' },
    ],
    hiddenTestCases: [
      { inputData: '[[1,4],[0,2],[3,5]]', expectedOutput: 'Merged count: 1' },
      { inputData: '[[2,3],[4,5],[6,7],[8,9],[1,10]]', expectedOutput: 'Merged count: 1' },
    ],
  },
  {
    id: 'MEDIUM-03-LINKED-LIST-CYCLE',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Fast Pointer Null Dereference in Cycle Detection',
    slug: 'floyd-cycle-null-check',
    description: 'Fix Floyd cycle finding algorithm so fast.next null checks prevent NullPointerException on linear lists.',
    starterCode: `public class Main {
    static class ListNode {
        int val;
        ListNode next;
        ListNode(int val) { this.val = val; }
    }

    public static boolean hasCycle(ListNode head) {
        if (head == null) return false;
        ListNode slow = head;
        ListNode fast = head;
        // Bug: fast.next is not checked before evaluating fast.next.next
        while (fast != null) {
            slow = slow.next;
            fast = fast.next.next;
            if (slow == fast) return true;
        }
        return false;
    }

    public static void main(String[] args) {
        ListNode n1 = new ListNode(1);
        ListNode n2 = new ListNode(2);
        ListNode n3 = new ListNode(3);
        n1.next = n2;
        n2.next = n3; // Linear list without cycle
        try {
            boolean cyc = hasCycle(n1);
            System.out.println("Cycle detected: " + cyc);
            if (!cyc) {
                System.out.println("FLAG REVEALED: DBG{CYCLE_DETECT_8102O}");
            }
        } catch (NullPointerException npe) {
            System.out.println("Tests failed. NullPointerException thrown during fast pointer step.");
        }
    }
}`,
    solutionCode: `public class Main {
    static class ListNode {
        int val;
        ListNode next;
        ListNode(int val) { this.val = val; }
    }

    public static boolean hasCycle(ListNode head) {
        if (head == null) return false;
        ListNode slow = head;
        ListNode fast = head;
        while (fast != null && fast.next != null) {
            slow = slow.next;
            fast = fast.next.next;
            if (slow == fast) return true;
        }
        return false;
    }

    public static void main(String[] args) {
        ListNode n1 = new ListNode(1);
        ListNode n2 = new ListNode(2);
        ListNode n3 = new ListNode(3);
        n1.next = n2;
        n2.next = n3;
        try {
            boolean cyc = hasCycle(n1);
            System.out.println("Cycle detected: " + cyc);
            if (!cyc) {
                System.out.println("FLAG REVEALED: DBG{CYCLE_DETECT_8102O}");
            }
        } catch (NullPointerException npe) {
            System.out.println("Tests failed. NullPointerException thrown during fast pointer step.");
        }
    }
}`,
    adminNotes: 'Loop condition was fast != null without fast.next != null, dereferencing null on odd length lists.',
    score: 20,
    displayOrder: 3,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{CYCLE_DETECT_8102O}',
    publicTestCases: [
      { inputData: '1 -> 2 -> 3 -> null', expectedOutput: 'Cycle detected (linear 3-node): false', explanation: 'Acyclic 3-node list' },
      { inputData: '1 -> 2 -> 1', expectedOutput: 'Cycle detected (2-node cycle): true', explanation: '2-node cyclic loop' },
      { inputData: 'null', expectedOutput: 'Cycle detected (empty list): false', explanation: 'Empty list base case' },
    ],
    hiddenTestCases: [
      { inputData: '1 -> null', expectedOutput: 'Cycle detected: false' },
      { inputData: '1 -> 2 -> 3 -> 4 -> 2', expectedOutput: 'Cycle detected: true' },
    ],
  },
  {
    id: 'MEDIUM-04-LRU-CACHE-EVICTION',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'LRU Cache Access Ordering & Eviction',
    slug: 'lru-eviction-order',
    description: 'Fix the custom LRU cache so reading a key refreshes its recency and evicts the true least-recently-used item.',
    starterCode: `import java.util.LinkedHashMap;
import java.util.Map;

public class Main {
    static class LRUCache {
        private final int capacity;
        private final Map<Integer, Integer> map;

        public LRUCache(int capacity) {
            this.capacity = capacity;
            // Bug: accessOrder is false (default insertion-order), not access-order!
            this.map = new LinkedHashMap<>(capacity, 0.75f, false);
        }

        public int get(int key) {
            return map.getOrDefault(key, -1);
        }

        public void put(int key, int value) {
            if (map.containsKey(key)) {
                map.remove(key);
            } else if (map.size() >= capacity) {
                int oldest = map.keySet().iterator().next();
                map.remove(oldest);
            }
            map.put(key, value);
        }
    }

    public static void main(String[] args) {
        LRUCache cache = new LRUCache(2);
        cache.put(1, 10);
        cache.put(2, 20);
        cache.get(1); // 1 accessed, 2 is now least recently used
        cache.put(3, 30); // should evict 2, not 1!

        int v1 = cache.get(1);
        int v2 = cache.get(2);
        int v3 = cache.get(3);
        System.out.println("v1=" + v1 + ", v2=" + v2 + ", v3=" + v3);

        if (v1 == 10 && v2 == -1 && v3 == 30) {
            System.out.println("FLAG REVEALED: DBG{LRU_EVICT_6619P}");
        } else {
            System.out.println("Tests failed. Evicted most recently accessed key instead of least.");
        }
    }
}`,
    solutionCode: `import java.util.LinkedHashMap;
import java.util.Map;

public class Main {
    static class LRUCache {
        private final int capacity;
        private final Map<Integer, Integer> map;

        public LRUCache(int capacity) {
            this.capacity = capacity;
            this.map = new LinkedHashMap<>(capacity, 0.75f, true);
        }

        public int get(int key) {
            return map.getOrDefault(key, -1);
        }

        public void put(int key, int value) {
            map.put(key, value);
            if (map.size() > capacity) {
                int oldest = map.keySet().iterator().next();
                map.remove(oldest);
            }
        }
    }

    public static void main(String[] args) {
        LRUCache cache = new LRUCache(2);
        cache.put(1, 10);
        cache.put(2, 20);
        cache.get(1);
        cache.put(3, 30);

        int v1 = cache.get(1);
        int v2 = cache.get(2);
        int v3 = cache.get(3);
        System.out.println("v1=" + v1 + ", v2=" + v2 + ", v3=" + v3);

        if (v1 == 10 && v2 == -1 && v3 == 30) {
            System.out.println("FLAG REVEALED: DBG{LRU_EVICT_6619P}");
        } else {
            System.out.println("Tests failed. Evicted most recently accessed key instead of least.");
        }
    }
}`,
    adminNotes: 'LinkedHashMap must be initialized with accessOrder=true so get() moves the key to most recent.',
    score: 20,
    displayOrder: 4,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{LRU_EVICT_6619P}',
    publicTestCases: [
      { inputData: 'cap=2, put(1,10), put(2,20), get(1), put(3,30)', expectedOutput: 'v1=10, v2=-1, v3=30', explanation: 'Key 2 evicted because key 1 was refreshed via get()' },
      { inputData: 'cap=1, put(1,1), put(2,2)', expectedOutput: 'get(1)=-1, get(2)=2', explanation: 'Capacity 1 cache immediate replacement' },
      { inputData: 'cap=2, put(1,5), get(99)', expectedOutput: 'get(99)=-1', explanation: 'Cache miss behavior' },
    ],
    hiddenTestCases: [
      { inputData: 'cap=3, put 1..4 in order', expectedOutput: 'get(1)=-1' },
      { inputData: 'cap=2, repeated update same key', expectedOutput: 'capacity maintained' },
    ],
  },
  {
    id: 'MEDIUM-05-TWO-SUM-HASHMAP',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Two Sum Duplicate Element Self-Matching',
    slug: 'twosum-self-match',
    description: 'Fix Two Sum complement lookup so a single element at index i is not paired with itself.',
    starterCode: `import java.util.*;

public class Main {
    public static int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> map = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            map.put(nums[i], i);
        }
        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];
            // Bug: map.containsKey(complement) without checking map.get(complement) != i
            if (map.containsKey(complement)) {
                return new int[]{ i, map.get(complement) };
            }
        }
        return new int[]{ -1, -1 };
    }

    public static void main(String[] args) {
        int[] nums = { 3, 2, 4 };
        int[] res = twoSum(nums, 6);
        System.out.println("Pair indices: [" + res[0] + ", " + res[1] + "]");
        // 3 + 3 = 6 would self-match index 0 if not guarded! Target pair is index 1 and 2 (2 + 4 = 6)
        if (res[0] == 1 && res[1] == 2) {
            System.out.println("FLAG REVEALED: DBG{TWOSUM_INDEX_3390Q}");
        } else {
            System.out.println("Tests failed. Element paired with itself.");
        }
    }
}`,
    solutionCode: `import java.util.*;

public class Main {
    public static int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> map = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            map.put(nums[i], i);
        }
        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];
            if (map.containsKey(complement) && map.get(complement) != i) {
                return new int[]{ i, map.get(complement) };
            }
        }
        return new int[]{ -1, -1 };
    }

    public static void main(String[] args) {
        int[] nums = { 3, 2, 4 };
        int[] res = twoSum(nums, 6);
        System.out.println("Pair indices: [" + res[0] + ", " + res[1] + "]");
        if (res[0] == 1 && res[1] == 2) {
            System.out.println("FLAG REVEALED: DBG{TWOSUM_INDEX_3390Q}");
        } else {
            System.out.println("Tests failed. Element paired with itself.");
        }
    }
}`,
    adminNotes: 'Self-pairing bug: map.get(complement) returned the current element index i.',
    score: 20,
    displayOrder: 5,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{TWOSUM_INDEX_3390Q}',
    publicTestCases: [
      { inputData: 'nums=[3, 2, 4], target=6', expectedOutput: 'Pair indices: [1, 2]', explanation: 'Avoids [0, 0] self match and identifies 2 + 4 = 6' },
      { inputData: 'nums=[2, 7, 11, 15], target=9', expectedOutput: 'Pair indices: [0, 1]', explanation: 'Standard two-sum pair at start' },
      { inputData: 'nums=[10, 20, 30], target=40', expectedOutput: 'Pair indices: [0, 2]', explanation: 'Matches indices 0 and 2 for 10 + 30 = 40' },
    ],
    hiddenTestCases: [
      { inputData: 'nums=[1, 5, 5, 8], target=10', expectedOutput: 'Pair indices: [1, 2]' },
      { inputData: 'nums=[1, 2, 3], target=10', expectedOutput: 'Pair indices: [-1, -1]' },
    ],
  },
  {
    id: 'MEDIUM-06-VALID-PARENTHESES',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Valid Parentheses Stack Underflow',
    slug: 'parentheses-stack-empty',
    description: 'Fix bracket validation to guard against EmptyStackException on leading closing brackets and ensure empty stack at finish.',
    starterCode: `import java.util.Stack;

public class Main {
    public static boolean isValid(String s) {
        Stack<Character> stack = new Stack<>();
        for (char c : s.toCharArray()) {
            if (c == '(' || c == '{' || c == '[') {
                stack.push(c);
            } else {
                // Bug: pop() without checking !stack.isEmpty() throws EmptyStackException
                char top = stack.pop();
                if (c == ')' && top != '(') return false;
                if (c == '}' && top != '{') return false;
                if (c == ']' && top != '[') return false;
            }
        }
        // Bug: forgot to check stack.isEmpty() at completion
        return true;
    }

    public static void main(String[] args) {
        try {
            boolean b1 = isValid("]");
            boolean b2 = isValid("({[]})");
            boolean b3 = isValid("((");
            System.out.println("b1=" + b1 + ", b2=" + b2 + ", b3=" + b3);
            if (!b1 && b2 && !b3) {
                System.out.println("FLAG REVEALED: DBG{STACK_PAREN_7721R}");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    solutionCode: `import java.util.Stack;

public class Main {
    public static boolean isValid(String s) {
        Stack<Character> stack = new Stack<>();
        for (char c : s.toCharArray()) {
            if (c == '(' || c == '{' || c == '[') {
                stack.push(c);
            } else {
                if (stack.isEmpty()) return false;
                char top = stack.pop();
                if (c == ')' && top != '(') return false;
                if (c == '}' && top != '{') return false;
                if (c == ']' && top != '[') return false;
            }
        }
        return stack.isEmpty();
    }

    public static void main(String[] args) {
        try {
            boolean b1 = isValid("]");
            boolean b2 = isValid("({[]})");
            boolean b3 = isValid("((");
            System.out.println("b1=" + b1 + ", b2=" + b2 + ", b3=" + b3);
            if (!b1 && b2 && !b3) {
                System.out.println("FLAG REVEALED: DBG{STACK_PAREN_7721R}");
            }
        } catch (Exception e) {
            System.out.println("Tests failed with exception: " + e.getClass().getSimpleName());
        }
    }
}`,
    adminNotes: 'Guarded against stack underflow on unexpected closing bracket and verified stack.isEmpty() at end.',
    score: 20,
    displayOrder: 6,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{STACK_PAREN_7721R}',
    publicTestCases: [
      { inputData: '"]", "({[]})", "(("', expectedOutput: 'b1=false, b2=true, b3=false', explanation: 'Validates leading closer rejection and trailing opener rejection' },
      { inputData: '"()[]{}"', expectedOutput: 'true', explanation: 'Sequential matching pairs' },
      { inputData: '"([)]"', expectedOutput: 'false', explanation: 'Interleaved invalid nesting' },
    ],
    hiddenTestCases: [
      { inputData: '""', expectedOutput: 'true' },
      { inputData: '"(((((((("', expectedOutput: 'false' },
    ],
  },
  {
    id: 'MEDIUM-07-QUICKSORT-PIVOT',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'QuickSort Duplicate Pivot Recursion',
    slug: 'quicksort-duplicate-pivot',
    description: 'Fix Hoare partition in QuickSort to prevent infinite recursion on arrays containing duplicate values.',
    starterCode: `import java.util.Arrays;

public class Main {
    public static void sort(int[] arr, int low, int high) {
        if (low < high) {
            int p = partition(arr, low, high);
            // Bug: partition did not advance past pivot, causing recursive loop when all items equal
            sort(arr, low, p);
            sort(arr, p + 1, high);
        }
    }

    private static int partition(int[] arr, int low, int high) {
        int pivot = arr[(low + high) / 2];
        int i = low - 1;
        int j = high + 1;
        while (true) {
            do { i++; } while (arr[i] < pivot);
            do { j--; } while (arr[j] > pivot);
            if (i >= j) return j;
            int tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
    }

    public static void main(String[] args) {
        int[] data = { 5, 2, 8, 5, 2, 5 };
        sort(data, 0, data.length - 1);
        System.out.println("Sorted: " + Arrays.toString(data));
        if (Arrays.equals(data, new int[]{ 2, 2, 5, 5, 5, 8 })) {
            System.out.println("FLAG REVEALED: DBG{QUICK_PIVOT_1948S}");
        } else {
            System.out.println("Tests failed. Array was not sorted correctly.");
        }
    }
}`,
    solutionCode: `import java.util.Arrays;

public class Main {
    public static void sort(int[] arr, int low, int high) {
        if (low < high) {
            int p = partition(arr, low, high);
            sort(arr, low, p);
            sort(arr, p + 1, high);
        }
    }

    private static int partition(int[] arr, int low, int high) {
        int pivot = arr[low + (high - low) / 2];
        int i = low - 1;
        int j = high + 1;
        while (true) {
            do { i++; } while (arr[i] < pivot);
            do { j--; } while (arr[j] > pivot);
            if (i >= j) return j;
            int tmp = arr[i];
            arr[i] = arr[j];
            arr[j] = tmp;
        }
    }

    public static void main(String[] args) {
        int[] data = { 5, 2, 8, 5, 2, 5 };
        sort(data, 0, data.length - 1);
        System.out.println("Sorted: " + Arrays.toString(data));
        if (Arrays.equals(data, new int[]{ 2, 2, 5, 5, 5, 8 })) {
            System.out.println("FLAG REVEALED: DBG{QUICK_PIVOT_1948S}");
        } else {
            System.out.println("Tests failed. Array was not sorted correctly.");
        }
    }
}`,
    adminNotes: 'Hoare partition midpoint calculation and duplicate element safety verified.',
    score: 20,
    displayOrder: 7,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{QUICK_PIVOT_1948S}',
    publicTestCases: [
      { inputData: '[5, 2, 8, 5, 2, 5]', expectedOutput: 'Sorted: [2, 2, 5, 5, 5, 8]', explanation: 'Array with duplicate pivot values' },
      { inputData: '[3, 1, 2]', expectedOutput: 'Sorted: [1, 2, 3]', explanation: 'Small distinct permutation' },
      { inputData: '[1]', expectedOutput: 'Sorted: [1]', explanation: 'Single element array' },
    ],
    hiddenTestCases: [
      { inputData: '[9, 8, 7, 6, 5]', expectedOutput: 'Sorted: [5, 6, 7, 8, 9]' },
      { inputData: '[4, 4, 4, 4]', expectedOutput: 'Sorted: [4, 4, 4, 4]' },
    ],
  },
  {
    id: 'MEDIUM-08-BINARY-TREE-VALIDATION',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'BST Subtree Min/Max Range Boundary',
    slug: 'bst-subtree-bounds',
    description: 'Fix Binary Search Tree validation to enforce global ancestor range (min, max) rather than only immediate local children.',
    starterCode: `public class Main {
    static class TreeNode {
        int val;
        TreeNode left, right;
        TreeNode(int val) { this.val = val; }
    }

    public static boolean isValidBST(TreeNode root) {
        if (root == null) return true;
        // Bug: only checks immediate children. A node in right subtree can violate root bound!
        if (root.left != null && root.left.val >= root.val) return false;
        if (root.right != null && root.right.val <= root.val) return false;
        return isValidBST(root.left) && isValidBST(root.right);
    }

    public static void main(String[] args) {
        // Tree: 5 -> left: 1, right: 4 (left: 3, right: 6). Notice 3 in right subtree is < 5!
        TreeNode root = new TreeNode(5);
        root.left = new TreeNode(1);
        TreeNode right = new TreeNode(4);
        right.left = new TreeNode(3);
        right.right = new TreeNode(6);
        root.right = right;

        boolean valid = isValidBST(root);
        System.out.println("Tree valid: " + valid);
        if (!valid) {
            System.out.println("FLAG REVEALED: DBG{BST_BOUNDS_5823T}");
        } else {
            System.out.println("Tests failed. Invalid subtree node was accepted as valid BST.");
        }
    }
}`,
    solutionCode: `public class Main {
    static class TreeNode {
        int val;
        TreeNode left, right;
        TreeNode(int val) { this.val = val; }
    }

    public static boolean isValidBST(TreeNode root) {
        return validate(root, null, null);
    }

    private static boolean validate(TreeNode node, Integer min, Integer max) {
        if (node == null) return true;
        if ((min != null && node.val <= min) || (max != null && node.val >= max)) {
            return false;
        }
        return validate(node.left, min, node.val) && validate(node.right, node.val, max);
    }

    public static void main(String[] args) {
        TreeNode root = new TreeNode(5);
        root.left = new TreeNode(1);
        TreeNode right = new TreeNode(4);
        right.left = new TreeNode(3);
        right.right = new TreeNode(6);
        root.right = right;

        boolean valid = isValidBST(root);
        System.out.println("Tree valid: " + valid);
        if (!valid) {
            System.out.println("FLAG REVEALED: DBG{BST_BOUNDS_5823T}");
        } else {
            System.out.println("Tests failed. Invalid subtree node was accepted as valid BST.");
        }
    }
}`,
    adminNotes: 'BST validation must propagate valid lower and upper bounds through all descendant subtrees.',
    score: 20,
    displayOrder: 8,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{BST_BOUNDS_5823T}',
    publicTestCases: [
      { inputData: '[5, 1, 4, null, null, 3, 6]', expectedOutput: 'Tree valid (violating right subtree node): false', explanation: 'Right subtree contains value 3 which violates root bound 5' },
      { inputData: '[2, 1, 3]', expectedOutput: 'Tree valid (3-node balanced BST): true', explanation: 'Valid 3-node binary search tree' },
      { inputData: '[10]', expectedOutput: 'Tree valid (single root): true', explanation: 'Single root node' },
    ],
    hiddenTestCases: [
      { inputData: '[1, 1]', expectedOutput: 'Tree valid: false' },
      { inputData: '[10, 5, 15, null, null, 6, 20]', expectedOutput: 'Tree valid: false' },
    ],
  },
  {
    id: 'MEDIUM-09-TRIE-PREFIX-SEARCH',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'Trie End-of-Word Flag Verification',
    slug: 'trie-is-end-word',
    description: 'Fix Trie word search so that prefix queries without isEndOfWord set to true do not falsely match whole words.',
    starterCode: `public class Main {
    static class TrieNode {
        TrieNode[] children = new TrieNode[26];
        boolean isEndOfWord = false;
    }

    static class Trie {
        TrieNode root = new TrieNode();

        public void insert(String word) {
            TrieNode node = root;
            for (char c : word.toCharArray()) {
                int idx = c - 'a';
                if (node.children[idx] == null) node.children[idx] = new TrieNode();
                node = node.children[idx];
            }
            node.isEndOfWord = true;
        }

        public boolean search(String word) {
            TrieNode node = root;
            for (char c : word.toCharArray()) {
                int idx = c - 'a';
                if (node.children[idx] == null) return false;
                node = node.children[idx];
            }
            // Bug: returns true for prefix even if isEndOfWord is false!
            return true;
        }
    }

    public static void main(String[] args) {
        Trie trie = new Trie();
        trie.insert("apple");
        boolean s1 = trie.search("app"); // "app" is only a prefix, not inserted word!
        boolean s2 = trie.search("apple");
        System.out.println("search('app')=" + s1 + ", search('apple')=" + s2);
        if (!s1 && s2) {
            System.out.println("FLAG REVEALED: DBG{TRIE_PREFIX_4276U}");
        } else {
            System.out.println("Tests failed. Prefix matched as complete word.");
        }
    }
}`,
    solutionCode: `public class Main {
    static class TrieNode {
        TrieNode[] children = new TrieNode[26];
        boolean isEndOfWord = false;
    }

    static class Trie {
        TrieNode root = new TrieNode();

        public void insert(String word) {
            TrieNode node = root;
            for (char c : word.toCharArray()) {
                int idx = c - 'a';
                if (node.children[idx] == null) node.children[idx] = new TrieNode();
                node = node.children[idx];
            }
            node.isEndOfWord = true;
        }

        public boolean search(String word) {
            TrieNode node = root;
            for (char c : word.toCharArray()) {
                int idx = c - 'a';
                if (node.children[idx] == null) return false;
                node = node.children[idx];
            }
            return node.isEndOfWord;
        }
    }

    public static void main(String[] args) {
        Trie trie = new Trie();
        trie.insert("apple");
        boolean s1 = trie.search("app");
        boolean s2 = trie.search("apple");
        System.out.println("search('app')=" + s1 + ", search('apple')=" + s2);
        if (!s1 && s2) {
            System.out.println("FLAG REVEALED: DBG{TRIE_PREFIX_4276U}");
        } else {
            System.out.println("Tests failed. Prefix matched as complete word.");
        }
    }
}`,
    adminNotes: 'search() returned true unconditionally at terminal node instead of inspecting isEndOfWord.',
    score: 20,
    displayOrder: 9,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{TRIE_PREFIX_4276U}',
    publicTestCases: [
      { inputData: 'insert("apple"), search("app"), search("apple")', expectedOutput: "search('app')=false, search('apple')=true", explanation: 'Differentiates true prefix from registered full word' },
      { inputData: 'search("orange")', expectedOutput: 'false', explanation: 'Unregistered word returns false' },
      { inputData: 'insert("a"), search("a")', expectedOutput: 'true', explanation: 'Single character registered word' },
    ],
    hiddenTestCases: [
      { inputData: 'insert("bat"), insert("batch"), search("bat")', expectedOutput: 'true' },
      { inputData: 'insert("dog"), search("do")', expectedOutput: 'false' },
    ],
  },
  {
    id: 'MEDIUM-10-MATRIX-ROTATION',
    roundSlug: 'medium',
    difficulty: 'MEDIUM',
    title: 'In-Place Matrix Transpose Diagonal Double-Swap',
    slug: 'matrix-transpose-double-swap',
    description: 'Fix in-place 90-degree clockwise matrix rotation so transposing does not swap elements twice back to their original coordinates.',
    starterCode: `import java.util.Arrays;

public class Main {
    public static void rotate(int[][] matrix) {
        int n = matrix.length;
        // Step 1: Transpose
        for (int i = 0; i < n; i++) {
            // Bug: j starts from 0 instead of i + 1, swapping every element twice!
            for (int j = 0; j < n; j++) {
                int temp = matrix[i][j];
                matrix[i][j] = matrix[j][i];
                matrix[j][i] = temp;
            }
        }
        // Step 2: Reverse each row
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n / 2; j++) {
                int temp = matrix[i][j];
                matrix[i][j] = matrix[i][n - 1 - j];
                matrix[i][n - 1 - j] = temp;
            }
        }
    }

    public static void main(String[] args) {
        int[][] mat = {
            { 1, 2, 3 },
            { 4, 5, 6 },
            { 7, 8, 9 }
        };
        rotate(mat);
        System.out.println("Row 0: " + Arrays.toString(mat[0]));
        if (Arrays.equals(mat[0], new int[]{ 7, 4, 1 })) {
            System.out.println("FLAG REVEALED: DBG{MATRIX_ROT_9934V}");
        } else {
            System.out.println("Tests failed. Double transpose inversion corrupted rotation.");
        }
    }
}`,
    solutionCode: `import java.util.Arrays;

public class Main {
    public static void rotate(int[][] matrix) {
        int n = matrix.length;
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                int temp = matrix[i][j];
                matrix[i][j] = matrix[j][i];
                matrix[j][i] = temp;
            }
        }
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n / 2; j++) {
                int temp = matrix[i][j];
                matrix[i][j] = matrix[i][n - 1 - j];
                matrix[i][n - 1 - j] = temp;
            }
        }
    }

    public static void main(String[] args) {
        int[][] mat = {
            { 1, 2, 3 },
            { 4, 5, 6 },
            { 7, 8, 9 }
        };
        rotate(mat);
        System.out.println("Row 0: " + Arrays.toString(mat[0]));
        if (Arrays.equals(mat[0], new int[]{ 7, 4, 1 })) {
            System.out.println("FLAG REVEALED: DBG{MATRIX_ROT_9934V}");
        } else {
            System.out.println("Tests failed. Double transpose inversion corrupted rotation.");
        }
    }
}`,
    adminNotes: 'In-place transpose must iterate j from i + 1 to n to swap each pair above diagonal exactly once.',
    score: 20,
    displayOrder: 10,
    validationType: 'EXACT_OUTPUT',
    flag: 'DBG{MATRIX_ROT_9934V}',
    publicTestCases: [
      { inputData: '[[1,2,3],[4,5,6],[7,8,9]]', expectedOutput: 'Row 0: [7, 4, 1]', explanation: '90-degree clockwise rotation of 3x3 matrix' },
      { inputData: '[[1,2],[3,4]]', expectedOutput: 'Row 0: [3, 1]', explanation: '2x2 matrix rotation' },
      { inputData: '[[42]]', expectedOutput: 'Row 0: [42]', explanation: '1x1 matrix invariance' },
    ],
    hiddenTestCases: [
      { inputData: '[[5,1,9,11],[2,4,8,10],[13,3,6,7],[15,14,12,16]]', expectedOutput: 'Row 0: [15, 13, 2, 5]' },
      { inputData: '[[0,0],[0,0]]', expectedOutput: 'Row 0: [0, 0]' },
    ],
  },
];
